/*
 * Copyright 2012 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkWeakRefCnt_DEFINED
#define SkWeakRefCnt_DEFINED

#include "include/core/SkRefCnt.h"
#include <atomic>

/** \class SkWeakRefCnt

    SkWeakRefCnt is the base class for objects that may be shared by multiple
    objects. When an existing strong owner wants to share a reference, it calls
    ref(). When a strong owner wants to release its reference, it calls
    unref(). When the shared object's strong reference count goes to zero as
    the result of an unref() call, its (virtual) weak_dispose method is called.
    It is an error for the destructor to be called explicitly (or via the
    object going out of scope on the stack or calling delete) if
    getRefCnt() > 1.

    In addition to strong ownership, an owner may instead obtain a weak
    reference by calling weak_ref(). A call to weak_ref() must be balanced by a
    call to weak_unref(). To obtain a strong reference from a weak reference,
    call try_ref(). If try_ref() returns true, the owner's pointer is now also
    a strong reference on which unref() must be called. Note that this does not
    affect the original weak reference, weak_unref() must still be called. When
    the weak reference count goes to zero, the object is deleted. While the
    weak reference count is positive and the strong reference count is zero the
    object still exists, but will be in the disposed state. It is up to the
    object to define what this means.

    Note that a strong reference implicitly implies a weak reference. As a
    result, it is allowable for the owner of a strong ref to call try_ref().
    This will have the same effect as calling ref(), but may be more expensive.

    Example:

    SkWeakRefCnt myRef = strongRef.weak_ref();
    ... // strongRef.unref() may or may not be called
    if (myRef.try_ref()) {
        ... // use myRef
        myRef.unref();
    } else {
        // myRef is in the disposed state
    }
    myRef.weak_unref();
*/
class SK_API SkWeakRefCnt : public SkRefCnt {
public:
    /** Default construct, initializing the reference counts to 1.
        The strong references collectively hold one weak reference. When the
        strong reference count goes to zero, the collectively held weak
        reference is released.
    */
    SkWeakRefCnt() : SkRefCnt(), fWeakCnt(1) {}

    /** Destruct, asserting that the weak reference count is 1.
    */
    ~SkWeakRefCnt() override {
#ifdef SK_DEBUG
        SkASSERT(getWeakCnt() == 1);
        fWeakCnt.store(0, std::memory_order_relaxed);
#endif
    }

#ifdef SK_DEBUG
    /** Return the weak reference count. */
    int32_t getWeakCnt() const {
        return fWeakCnt.load(std::memory_order_relaxed);
    }
#endif

private:
    /** If fRefCnt is 0, returns 0.
     *  Otherwise increments fRefCnt, acquires, and returns the old value.
     */
    int32_t atomic_conditional_acquire_strong_ref() const {
        int32_t prev = fRefCnt.load(std::memory_order_relaxed);
        do {
            if (0 == prev) {
                break;
            }
        } while(!fRefCnt.compare_exchange_weak(prev, prev+1, std::memory_order_acquire,
                                                             std::memory_order_relaxed));
        return prev;
    }

public:
    /** Creates a strong reference from a weak reference, if possible. The
        caller must already be an owner. If try_ref() returns true the owner
        is in posession of an additional strong reference. Both the original
        reference and new reference must be properly unreferenced. If try_ref()
        returns false, no strong reference could be created and the owner's
        reference is in the same state as before the call.
    */
    bool SK_WARN_UNUSED_RESULT try_ref() const {
        if (atomic_conditional_acquire_strong_ref() != 0) {
            // Acquire barrier (L/SL), if not provided above.
            // Prevents subsequent code from happening before the increment.
            return true;
        }
        return false;
    }

    /** Increment the weak reference count. Must be balanced by a call to
        weak_unref().
    */
    void weak_ref() const {
        SkASSERT(getRefCnt() > 0);
        SkASSERT(getWeakCnt() > 0);
        // No barrier required.
        (void)fWeakCnt.fetch_add(+1, std::memory_order_relaxed);
    }

    /** Decrement the weak reference count. If the weak reference count is 1
        before the decrement, then call delete on the object. Note that if this
        is the case, then the object needs to have been allocated via new, and
        not on the stack.
    */
    void weak_unref() const {
        SkASSERT(getWeakCnt() > 0);
        // A release here acts in place of all releases we "should" have been doing in ref().
        if (1 == fWeakCnt.fetch_add(-1, std::memory_order_acq_rel)) {
            // Like try_ref(), the acquire is only needed on success, to make sure
            // code in internal_dispose() doesn't happen before the decrement.
#ifdef SK_DEBUG
            // so our destructor won't complain
            fWeakCnt.store(1, std::memory_order_relaxed);
#endif
            this->INHERITED::internal_dispose();
        }
    }

    /** Returns true if there are no strong references to the object. When this
        is the case all future calls to try_ref() will return false.
    */
    bool weak_expired() const {
        return fRefCnt.load(std::memory_order_relaxed) == 0;
    }

protected:
    /** Called when the strong reference count goes to zero. This allows the
        object to free any resources it may be holding. Weak references may
        still exist and their level of allowed access to the object is defined
        by the object's class.
    */
    virtual void weak_dispose() const {
    }

private:
    /** Called when the strong reference count goes to zero. Calls weak_dispose
        on the object and releases the implicit weak reference held
        collectively by the strong references.
    */
    void internal_dispose() const override {
        weak_dispose();
        weak_unref();
    }

    /* Invariant: fWeakCnt = #weak + (fRefCnt > 0 ? 1 : 0) */
    mutable std::atomic<int32_t> fWeakCnt;

    using INHERITED = SkRefCnt;
};

#endif
