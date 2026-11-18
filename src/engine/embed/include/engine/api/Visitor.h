#pragma once

// How a class shows the collector what its instances refer to.

#include "engine/api/Handles.h"

namespace JSC {

class AbstractSlotVisitor {
    WTF_MAKE_NONCOPYABLE(AbstractSlotVisitor);

public:
    // Attributes what is appended meanwhile to the cell.
    class ReferrerContext {
    public:
        ReferrerContext(AbstractSlotVisitor& visitor, HeapCell* cell)
            : m_visitor(visitor)
            , m_previous(Engine::visitor_replace_referrer(visitor, reinterpret_cast<size_t>(cell)))
        {
        }
        ~ReferrerContext() { Engine::visitor_replace_referrer(m_visitor, m_previous); }

    private:
        AbstractSlotVisitor& m_visitor;
        size_t m_previous;
    };

    ALWAYS_INLINE void appendUnbarriered(JSValue value)
    {
        if (value.isCell() && value)
            Engine::visitor_append(*this, value.asCell());
    }
    ALWAYS_INLINE void appendUnbarriered(JSCell* cell) { appendUnbarriered(JSValue(cell)); }
    ALWAYS_INLINE void appendHiddenUnbarriered(JSValue value)
    {
        if (value.isCell() && value)
            Engine::visitor_append_hidden(*this, value.asCell());
    }
    template<typename T> ALWAYS_INLINE void append(const WriteBarrierBase<T>& field) { appendUnbarriered(JSValue::decode(field.bits())); }
    template<typename T> ALWAYS_INLINE void appendHidden(const WriteBarrierBase<T>& field) { appendHiddenUnbarriered(JSValue::decode(field.bits())); }
    template<typename T> void append(const Weak<T>& weak) { appendUnbarriered(reinterpret_cast<JSCell*>(weak.get())); }
    template<typename Iterator> void append(Iterator begin, Iterator end)
    {
        for (auto it = begin; it != end; ++it)
            append(*it);
    }
    void appendValues(const WriteBarrierBase<Unknown>* fields, size_t count) { append(fields, fields + count); }
    void appendValuesHidden(const WriteBarrierBase<Unknown>* fields, size_t count)
    {
        for (size_t i = 0; i < count; ++i)
            appendHidden(fields[i]);
    }

    bool isMarked(const void* cell) const { return Engine::visitor_is_marked(*this, static_cast<const JSCell*>(cell)); }
    bool addOpaqueRoot(void* root) { return Engine::visitor_add_opaque_root(*this, root); }
    bool containsOpaqueRoot(void* root) const { return Engine::visitor_contains_opaque_root(*this, root); }
    void reportExtraMemoryVisited(size_t bytes) { Engine::visitor_report_extra_memory(*this, bytes); }
};

// The same object.
class SlotVisitor final : public AbstractSlotVisitor {};

template<typename Visitor> class SetRootMarkReasonScope {
public:
    SetRootMarkReasonScope(Visitor& visitor, RootMarkReason reason)
        : m_visitor(visitor)
        , m_previous(Engine::visitor_replace_root_reason(visitor, reason))
    {
    }
    ~SetRootMarkReasonScope() { Engine::visitor_replace_root_reason(m_visitor, m_previous); }

private:
    Visitor& m_visitor;
    RootMarkReason m_previous;
};

#define ENGINE_DECLARE_VISIT(modifier, method)                                            \
private:                                                                                  \
    template<typename Visitor> ALWAYS_INLINE static void method##Impl(JSCell*, Visitor&); \
                                                                                          \
public:                                                                                   \
    static void method(JSCell* cell, AbstractSlotVisitor& visitor)                        \
    {                                                                                     \
        method(cell, static_cast<SlotVisitor&>(visitor));                                 \
    }                                                                                     \
    modifier static void method(JSCell*, SlotVisitor&)

#define ENGINE_DEFINE_VISIT(modifier, className, method)                                                 \
    modifier void className::method(JSCell* cell, SlotVisitor& visitor) { method##Impl(cell, visitor); } \
    static_assert(true)

#define DECLARE_VISIT_CHILDREN_WITH_MODIFIER(modifier) ENGINE_DECLARE_VISIT(modifier, visitChildren)
#define DEFINE_VISIT_CHILDREN_WITH_MODIFIER(modifier, className) ENGINE_DEFINE_VISIT(modifier, className, visitChildren)
#define DECLARE_VISIT_CHILDREN ENGINE_DECLARE_VISIT(, visitChildren)
#define DEFINE_VISIT_CHILDREN(className) ENGINE_DEFINE_VISIT(, className, visitChildren)
#define DECLARE_VISIT_OUTPUT_CONSTRAINTS ENGINE_DECLARE_VISIT(, visitOutputConstraints)
#define DEFINE_VISIT_OUTPUT_CONSTRAINTS(className) ENGINE_DEFINE_VISIT(, className, visitOutputConstraints)
#define DEFINE_VISIT_ADDITIONAL_CHILDREN_IN_GC_THREAD(className)                           \
    template void className::visitAdditionalChildrenInGCThread(JSC::AbstractSlotVisitor&); \
    template void className::visitAdditionalChildrenInGCThread(JSC::SlotVisitor&)

// In a class whose Rust type exports the method as `engine_<name>_visit_children`.
#define ENGINE_DECLARE_VISIT_CHILDREN(name)                                                         \
    static void visitChildren(JSCell*, SlotVisitor&) ENGINE_SYMBOL(engine_##name##_visit_children); \
    static void visitChildren(JSCell*, AbstractSlotVisitor&) ENGINE_SYMBOL(engine_##name##_visit_children)

} // namespace JSC

using JSC::AbstractSlotVisitor;
using JSC::JSCell;
using JSC::SlotVisitor;
