#pragma once

#include "engine/support/CompactPointerTuple.h"
#include "engine/support/WeakPtrImpl.h"

namespace WTF {

enum class WeakPtrFactoryInitialization { Lazy };

template<typename T, typename Impl>
class WeakPtrFactory {
    WTF_MAKE_NONCOPYABLE(WeakPtrFactory);

public:
    WeakPtrFactory() = default;

    ~WeakPtrFactory()
    {
        if (auto* impl = this->impl()) {
            impl->clear();
            impl->deref();
        }
    }

    Impl* impl() const LIFETIME_BOUND { return m_implAndBitfield.pointer(); }

    void initializeIfNeeded(const T& object) const
    {
        static_assert(std::is_final_v<Impl>);
        if (impl())
            return;
        m_implAndBitfield.setPointer(new Impl(const_cast<T*>(&object)));
#if ASAN_ENABLED
        m_implForLeakSanitizer = impl();
#endif
    }

    // For the owner to use as it likes.
    uint16_t bitfield() const { return m_implAndBitfield.type(); }
    void setBitfield(uint16_t value) const { m_implAndBitfield.setType(value); }

private:
    mutable CompactPointerTuple<Impl*, uint16_t> m_implAndBitfield;
#if ASAN_ENABLED
    mutable Impl* m_implForLeakSanitizer { nullptr };
#endif
};

template<typename T, WeakPtrFactoryInitialization = WeakPtrFactoryInitialization::Lazy, typename Impl = DefaultWeakPtrImpl>
class CanMakeWeakPtr {
public:
    using WeakValueType = T;
    using WeakPtrImplType = Impl;

    Impl& weakImpl() const
    {
        initializeWeakPtrFactory();
        return *m_weakPtrFactory.impl();
    }

    Impl* weakImplIfExists() const { return m_weakPtrFactory.impl(); }

protected:
    CanMakeWeakPtr() = default;
    CanMakeWeakPtr(const CanMakeWeakPtr&) {}
    CanMakeWeakPtr& operator=(const CanMakeWeakPtr&) { return *this; }

    void initializeWeakPtrFactory() const { m_weakPtrFactory.initializeIfNeeded(static_cast<const T&>(*this)); }

    const WeakPtrFactory<T, Impl>& weakPtrFactory() const LIFETIME_BOUND { return m_weakPtrFactory; }

private:
    WeakPtrFactory<T, Impl> m_weakPtrFactory;
};

template<typename T, WeakPtrFactoryInitialization initialization, typename Impl>
using CanMakeWeakPtrWithBitField = CanMakeWeakPtr<T, initialization, Impl>;

template<typename T>
class AbstractRefCountedAndCanMakeWeakPtr : public CanMakeWeakPtr<T> {
public:
    virtual void ref() const = 0;
    virtual void deref() const = 0;

protected:
    virtual ~AbstractRefCountedAndCanMakeWeakPtr() = default;
};

}

// For a class with more than one base that can.
#define USING_CAN_MAKE_WEAKPTR(Base) \
    using Base::weakImpl;            \
    using Base::weakImplIfExists;    \
    using Base::WeakValueType;       \
    using Base::WeakPtrImplType;

using WTF::AbstractRefCountedAndCanMakeWeakPtr;
using WTF::CanMakeWeakPtr;
using WTF::CanMakeWeakPtrWithBitField;
using WTF::WeakPtrFactoryInitialization;
