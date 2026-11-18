#pragma once

// References to cells: from another cell, and from outside the heap.

#include "engine/api/VM.h"

namespace Engine {

struct WeakOwner {
    bool (*isReachableFromOpaqueRoots)(const WeakOwner&, JSC::WeakImpl&, void* context, JSC::AbstractSlotVisitor&, WTF::ASCIILiteral* reason);
    bool (*finalize)(const WeakOwner&, JSC::WeakImpl&, void* context);
};
ENGINE_CHECK_SIZE(WeakOwner, sizeOfWeakOwner);
ENGINE_CHECK_OFFSET(WeakOwner, finalize, WeakOwner_finalize);

} // namespace Engine

namespace JSC {

template<typename T> struct HandleTypes {
    using ExternalType = T*;
    static T* decode(EncodedJSValue bits) { return reinterpret_cast<T*>(bits); }
    static EncodedJSValue encode(T* cell) { return reinterpret_cast<EncodedJSValue>(cell); }
};

template<> struct HandleTypes<Unknown> {
    using ExternalType = JSValue;
    static JSValue decode(EncodedJSValue bits) { return JSValue::decode(bits); }
    static EncodedJSValue encode(JSValue value) { return JSValue::encode(value); }
};

// A field of a cell, or of something that a cell owns and visits.
template<typename T> class WriteBarrierBase {
public:
    using ExternalType = typename HandleTypes<T>::ExternalType;

    ALWAYS_INLINE ExternalType get() const { return HandleTypes<T>::decode(m_bits); }
    ExternalType unvalidatedGet() const { return get(); }
    ALWAYS_INLINE void set(VM& vm, const JSCell* owner, ExternalType value)
    {
        setWithoutWriteBarrier(value);
        if constexpr (std::is_same_v<T, Unknown>)
            vm.writeBarrier(owner, value);
        else {
            ASSERT(value);
            vm.writeBarrier(owner);
        }
    }
    void setMayBeNull(VM& vm, const JSCell* owner, ExternalType value)
    {
        setWithoutWriteBarrier(value);
        vm.writeBarrier(owner);
    }
    ALWAYS_INLINE void setWithoutWriteBarrier(ExternalType value) { __atomic_store_n(&m_bits, HandleTypes<T>::encode(value), __ATOMIC_RELAXED); }
    void clear() { __atomic_store_n(&m_bits, 0, __ATOMIC_RELAXED); }

    T* operator->() const
        requires(!std::is_same_v<T, Unknown>)
    {
        return get();
    }
    T* operator*() const
        requires(!std::is_same_v<T, Unknown>)
    {
        return get();
    }
    explicit operator bool() const { return m_bits; }
    bool operator!() const { return !m_bits; }

    // From any thread.
    EncodedJSValue bits() const { return __atomic_load_n(&m_bits, __ATOMIC_RELAXED); }

protected:
    EncodedJSValue m_bits;
};

enum WriteBarrierEarlyInitTag { WriteBarrierEarlyInit };

template<typename T> class WriteBarrier : public WriteBarrierBase<T> {
public:
    using typename WriteBarrierBase<T>::ExternalType;

    WriteBarrier() { this->m_bits = 0; }
    WriteBarrier(VM& vm, const JSCell* owner, ExternalType value) { this->set(vm, owner, value); }
    // In the constructor of the owner, which nothing has visited yet.
    WriteBarrier(ExternalType value, WriteBarrierEarlyInitTag) { this->m_bits = HandleTypes<T>::encode(value); }
};

template<typename T, typename U> bool operator==(const WriteBarrierBase<T>& a, const WriteBarrierBase<U>& b) { return a.bits() == b.bits(); }

// As memcpy, but a marker never sees half a word.
template<typename T> void gcSafeMemcpy(T* target, const T* source, size_t bytes)
{
    static_assert(sizeof(T) == sizeof(uint64_t));
    Engine::move_words(reinterpret_cast<const uint64_t*>(source), reinterpret_cast<uint64_t*>(target), bytes / sizeof(uint64_t));
}

using HandleSlot = JSValue*;

template<typename T> class Handle {
public:
    using ExternalType = typename HandleTypes<T>::ExternalType;

    explicit Handle(HandleSlot slot = nullptr)
        : m_slot(slot)
    {
    }

    HandleSlot slot() const { return m_slot; }
    ExternalType get() const { return HandleTypes<T>::decode(m_slot ? JSValue::encode(*m_slot) : 0); }
    explicit operator bool() const { return m_slot && *m_slot; }
    bool operator!() const { return !m_slot || !*m_slot; }
    T* operator->() const
        requires(!std::is_same_v<T, Unknown>)
    {
        return get();
    }
    T* operator*() const
        requires(!std::is_same_v<T, Unknown>)
    {
        return get();
    }

protected:
    HandleSlot m_slot;
};

// Keeps a value alive from anywhere in memory.
template<typename T> class Strong final : public Handle<T> {
    WTF_DEPRECATED_MAKE_FAST_ALLOCATED(Strong);
    using Handle<T>::m_slot;

public:
    using typename Handle<T>::ExternalType;

    Strong() = default;
    Strong(VM& vm, ExternalType value = ExternalType()) { set(vm, value); }
    Strong(const Strong& other) { *this = other; }
    template<typename U> Strong(const Strong<U>& other) { assign(other.slot(), other.get()); }
    Strong(Strong&& other) { m_slot = std::exchange(other.m_slot, nullptr); }
    ~Strong() { clear(); }

    Strong& operator=(const Strong& other)
    {
        assign(other.m_slot, other.get());
        return *this;
    }
    Strong& operator=(Strong&& other)
    {
        Strong moved(WTF::move(other));
        std::swap(m_slot, moved.m_slot);
        return *this;
    }

    void set(VM& vm, ExternalType value)
    {
        if (m_slot)
            *m_slot = JSValue::decode(HandleTypes<T>::encode(value));
        else
            m_slot = reinterpret_cast<HandleSlot>(Engine::strong_slot_allocate(vm, JSValue::decode(HandleTypes<T>::encode(value))));
    }

    void clear()
    {
        if (m_slot)
            Engine::strong_slot_free(reinterpret_cast<size_t>(std::exchange(m_slot, nullptr)));
    }

private:
    void assign(HandleSlot source, ExternalType value)
    {
        if (!source)
            clear();
        else if (m_slot)
            *m_slot = JSValue::decode(HandleTypes<T>::encode(value));
        else
            m_slot = reinterpret_cast<HandleSlot>(Engine::strong_slot_duplicate(reinterpret_cast<size_t>(source)));
    }
};

class WeakImpl {
public:
    JSCell* cellIfLive() const { return m_ownerAndState & stateMask ? nullptr : m_cell.asCell(); }
    HandleSlot slot() { return &m_cell; }
    // The memory is reclaimed by the next collection that looks at the handle.
    void deallocate() { __atomic_store_n(&m_ownerAndState, stateMask, __ATOMIC_RELEASE); }

private:
    static constexpr uintptr_t stateMask = Engine::Layout::weakStateMask;
    static void checkLayout();

    JSValue m_cell;
    uintptr_t m_ownerAndState;
};

inline void WeakImpl::checkLayout()
{
    ENGINE_CHECK_OFFSET(WeakImpl, m_cell, WeakImpl_cell);
    ENGINE_CHECK_OFFSET(WeakImpl, m_ownerAndState, WeakImpl_owner_and_state);
}

// Decides whether the target of a weak handle lives on, and hears of its death.
class WeakHandleOwner {
public:
    enum class FinalizeResult : bool { KeepImpl,
        DeallocateImpl };

    virtual ~WeakHandleOwner() = default;
    virtual bool isReachableFromOpaqueRoots(Handle<Unknown>, void*, AbstractSlotVisitor&, ASCIILiteral* = nullptr) { return false; }
    virtual FinalizeResult finalize(Handle<Unknown>, void*) { return FinalizeResult::KeepImpl; }

    const Engine::WeakOwner& callbacks() const { return m_callbacks; }

private:
    static WeakHandleOwner& from(const Engine::WeakOwner& callbacks) { return Engine::fieldAt<WeakHandleOwner>(&callbacks, -OBJECT_OFFSETOF(WeakHandleOwner, m_callbacks)); }
    static bool callIsReachable(const Engine::WeakOwner& callbacks, WeakImpl& impl, void* context, AbstractSlotVisitor& visitor, ASCIILiteral* reason) { return from(callbacks).isReachableFromOpaqueRoots(Handle<Unknown>(impl.slot()), context, visitor, reason); }
    static bool callFinalize(const Engine::WeakOwner& callbacks, WeakImpl& impl, void* context) { return from(callbacks).finalize(Handle<Unknown>(impl.slot()), context) == FinalizeResult::DeallocateImpl; }

    Engine::WeakOwner m_callbacks { callIsReachable, callFinalize };
};

// Refers to a cell from anywhere in memory without keeping it alive.
template<typename T> class Weak final {
    WTF_MAKE_NONCOPYABLE(Weak);
    WTF_DEPRECATED_MAKE_FAST_ALLOCATED(Weak);

public:
    Weak() = default;
    Weak(std::nullptr_t) {}
    Weak(T* cell, WeakHandleOwner* owner = nullptr, void* context = nullptr)
        : m_impl(cell ? Engine::weak_allocate(cell, owner ? &owner->callbacks() : nullptr, context) : nullptr)
    {
    }
    Weak(Weak&& other)
        : m_impl(std::exchange(other.m_impl, nullptr))
    {
    }
    ~Weak() { clear(); }

    Weak& operator=(Weak&& other)
    {
        Weak moved(WTF::move(other));
        std::swap(m_impl, moved.m_impl);
        return *this;
    }

    T* get() const { return m_impl ? reinterpret_cast<T*>(m_impl->cellIfLive()) : nullptr; }
    T* operator->() const { return get(); }
    T& operator*() const { return *get(); }
    explicit operator bool() const { return get(); }
    bool operator!() const { return !get(); }
    // Whether it refers, or referred, to that cell.
    bool was(T* cell) const { return m_impl && m_impl->slot()->asCell() == cell; }

    void clear()
    {
        if (m_impl)
            std::exchange(m_impl, nullptr)->deallocate();
    }

private:
    WeakImpl* m_impl { nullptr };
};

template<typename T> bool operator==(const Weak<T>& a, const Weak<T>& b) { return a.get() == b.get(); }

template<typename T> void weakClear(Weak<T>& weak, T* cell)
{
    ASSERT_UNUSED(cell, weak.was(cell));
    weak.clear();
}

} // namespace JSC

namespace WTF {

template<typename T> struct VectorTraits<JSC::WriteBarrier<T>> : SimpleClassVectorTraits {};
template<typename T> struct VectorTraits<JSC::Strong<T>> : MovableClassVectorTraits {};
template<typename T> struct VectorTraits<JSC::Weak<T>> : MovableClassVectorTraits {};
template<typename T> struct HashTraits<JSC::Weak<T>> : GenericHashTraits<JSC::Weak<T>> {
    using PeekType = T*;
    static PeekType peek(const JSC::Weak<T>& value) { return value.get(); }
};

} // namespace WTF

namespace JSC {

// A map whose entries go when their values die.
template<typename Key, typename Value, typename Hash = DefaultHash<Key>, typename KeyTraits = HashTraits<Key>>
class WeakGCMap final {
    WTF_DEPRECATED_MAKE_FAST_ALLOCATED(WeakGCMap);

public:
    explicit WeakGCMap(VM&) {}

    Value* get(const Key& key) const { return m_map.get(key); }

    void set(const Key& key, Weak<Value> value)
    {
        m_map.set(key, WTF::move(value));
        if (m_map.size() < m_sizeToPruneAt)
            return;
        m_map.removeIf([](auto& entry) { return !entry.value; });
        m_sizeToPruneAt = std::max(m_map.size() * 2, smallestSizeToPruneAt);
    }

private:
    static constexpr unsigned smallestSizeToPruneAt = 32;

    UncheckedKeyHashMap<Key, Weak<Value>, Hash, KeyTraits> m_map;
    unsigned m_sizeToPruneAt { smallestSizeToPruneAt };
};

} // namespace JSC
