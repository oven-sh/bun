/*
 * Copyright (C) 2013-2018 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. AND ITS CONTRIBUTORS ``AS IS''
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL APPLE INC. OR ITS CONTRIBUTORS
 * BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
 * THE POSSIBILITY OF SUCH DAMAGE.
 */

#pragma once

#include "EventTargetInlines.h"
#include "Node.h"
#include <wtf/HashCountedSet.h>
#include <wtf/RawPtrTraits.h>
#include <wtf/RefPtr.h>

namespace WebCore {

class Node;

class GCReachableRefMap {
public:
    static inline bool contains(EventTarget& target) { return target.isInGCReacheableRefMap(); }
    static inline void add(EventTarget& target)
    {
        if (map().add(&target).isNewEntry)
            target.setIsInGCReacheableRefMap(true);
    }
    static inline void remove(EventTarget& target)
    {
        if (map().remove(&target))
            target.setIsInGCReacheableRefMap(false);
    }

private:
    WEBCORE_EXPORT static HashCountedSet<EventTarget*>& map();
};

template <typename T>
    requires std::same_as<T, std::remove_const_t<T>>
class GCReachableRef {
    WTF_MAKE_NONCOPYABLE(GCReachableRef);
public:

    GCReachableRef(T& object)
        : m_ptr(&object)
    {
        GCReachableRefMap::add(object);
    }

    ~GCReachableRef()
    {
        if (RefPtr<EventTarget> target = WTF::move(m_ptr))
            GCReachableRefMap::remove(*target);
    }

    GCReachableRef(GCReachableRef&& other)
        : m_ptr(WTF::move(other.m_ptr))
    {
    }

    T* operator->() const { return &get(); }
    T* ptr() const RETURNS_NONNULL { return &get(); }
    T& get() const { ASSERT(m_ptr); return *m_ptr; }
    operator T&() const { return get(); }
    bool operator!() const { return !get(); }

    // Hash table deleted values, which are only constructed and never copied or destroyed.
    GCReachableRef(WTF::HashTableDeletedValueType)
        : m_ptr(RefPtr<T>::PtrTraits::hashTableDeletedValue())
    { }
    bool isHashTableDeletedValue() const { return m_ptr.isHashTableDeletedValue(); }

    GCReachableRef(WTF::HashTableEmptyValueType)
        : m_ptr(nullptr)
    { }
    bool isHashTableEmptyValue() const { return !m_ptr; }

    const T* ptrAllowingHashTableEmptyValue() const { ASSERT(m_ptr || isHashTableEmptyValue()); return m_ptr.get(); }
    T* ptrAllowingHashTableEmptyValue() { ASSERT(m_ptr || isHashTableEmptyValue()); return m_ptr.get(); }

    void assignToHashTableEmptyValue(GCReachableRef&& reference)
    {
        ASSERT(!m_ptr);
        m_ptr = WTF::move(reference.m_ptr);
        ASSERT(m_ptr);
    }

private:
    RefPtr<T> m_ptr;
};

} // namespace WebCore

namespace WTF {

template<typename P> struct HashTraits<WebCore::GCReachableRef<P>> : SimpleClassHashTraits<WebCore::GCReachableRef<P>> {
    static const bool emptyValueIsZero = true;
    static WebCore::GCReachableRef<P> emptyValue() { return HashTableEmptyValue; }

    template <typename>
    static void constructEmptyValue(WebCore::GCReachableRef<P>& slot)
    {
        new (NotNull, std::addressof(slot)) WebCore::GCReachableRef<P>(HashTableEmptyValue);
    }

    static const bool hasIsEmptyValueFunction = true;
    static bool isEmptyValue(const WebCore::GCReachableRef<P>& value) { return value.isHashTableEmptyValue(); }

    static void assignToEmpty(WebCore::GCReachableRef<P>& emptyValue, WebCore::GCReachableRef<P>&& newValue)
    {
        ASSERT(isEmptyValue(emptyValue));
        emptyValue.assignToHashTableEmptyValue(WTF::move(newValue));
    }

    typedef P* PeekType;
    static PeekType peek(const WebCore::GCReachableRef<P>& value) { return const_cast<PeekType>(value.ptrAllowingHashTableEmptyValue()); }
    static PeekType peek(P* value) { return value; }

    typedef std::optional<WebCore::GCReachableRef<P>> TakeType;
    static TakeType take(WebCore::GCReachableRef<P>&& value) { return isEmptyValue(value) ? std::nullopt : std::optional<WebCore::GCReachableRef<P>>(WTF::move(value)); }
};

template <typename T>
struct GetPtrHelper<WebCore::GCReachableRef<T>> {
    using PtrType = T*;
    using UnderlyingType = T;
    static T* getPtr(const WebCore::GCReachableRef<T>& reference) { return const_cast<T*>(reference.ptr()); }
};

template <typename T>
struct IsSmartPtr<WebCore::GCReachableRef<T>> {
    static const bool value = true;
    static constexpr bool isNullable = true;
};

template<typename P> struct PtrHash<WebCore::GCReachableRef<P>> : PtrHashBase<WebCore::GCReachableRef<P>, IsSmartPtr<WebCore::GCReachableRef<P>>::value> {
    static const bool safeToCompareToEmptyOrDeleted = false;
};

template<typename P> struct DefaultHash<WebCore::GCReachableRef<P>> : PtrHash<WebCore::GCReachableRef<P>> { };

} // namespace WTF

