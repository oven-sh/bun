/*
 * Copyright 2019 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkCFObject_DEFINED
#define SkCFObject_DEFINED

#ifdef __APPLE__

#include "include/core/SkTypes.h"

#include <cstddef>      // std::nullptr_t

#import <CoreFoundation/CoreFoundation.h>

/**
 * Wrapper class for managing lifetime of CoreFoundation objects. It will call
 * CFRetain and CFRelease appropriately on creation, assignment, and deletion.
 * Based on sk_sp<>.
 */
template <typename T> static inline T SkCFSafeRetain(T obj) {
    if (obj) {
        CFRetain(obj);
    }
    return obj;
}

template <typename T> static inline void SkCFSafeRelease(T obj) {
    if (obj) {
        CFRelease(obj);
    }
}

template <typename T> class sk_cfp {
public:
    using element_type = T;

    constexpr sk_cfp() {}
    constexpr sk_cfp(std::nullptr_t) {}

    /**
     *  Shares the underlying object by calling CFRetain(), so that both the argument and the newly
     *  created sk_cfp both have a reference to it.
     */
    sk_cfp(const sk_cfp<T>& that) : fObject(SkCFSafeRetain(that.get())) {}

    /**
     *  Move the underlying object from the argument to the newly created sk_cfp. Afterwards only
     *  the new sk_cfp will have a reference to the object, and the argument will point to null.
     *  No call to CFRetain() or CFRelease() will be made.
     */
    sk_cfp(sk_cfp<T>&& that) : fObject(that.release()) {}

    /**
     *  Adopt the bare object into the newly created sk_cfp.
     *  No call to CFRetain() or CFRelease() will be made.
     */
    explicit sk_cfp(T obj) {
        fObject = obj;
    }

    /**
     *  Calls CFRelease() on the underlying object pointer.
     */
    ~sk_cfp() {
        SkCFSafeRelease(fObject);
        SkDEBUGCODE(fObject = nil);
    }

    sk_cfp<T>& operator=(std::nullptr_t) { this->reset(); return *this; }

    /**
     *  Shares the underlying object referenced by the argument by calling CFRetain() on it. If this
     *  sk_cfp previously had a reference to an object (i.e. not null) it will call CFRelease()
     *  on that object.
     */
    sk_cfp<T>& operator=(const sk_cfp<T>& that) {
        if (this != &that) {
            this->reset(SkCFSafeRetain(that.get()));
        }
        return *this;
    }

    /**
     *  Move the underlying object from the argument to the sk_cfp. If the sk_cfp
     * previously held a reference to another object, CFRelease() will be called on that object.
     * No call to CFRetain() will be made.
     */
    sk_cfp<T>& operator=(sk_cfp<T>&& that) {
        this->reset(that.release());
        return *this;
    }

    explicit operator bool() const { return this->get() != nil; }

    T get() const { return fObject; }
    T operator*() const {
        SkASSERT(fObject);
        return fObject;
    }

    /**
     *  Adopt the new object, and call CFRelease() on any previously held object (if not null).
     *  No call to CFRetain() will be made.
     */
    void reset(T object = nil) {
        // Need to unref after assigning, see
        // http://wg21.cmeerw.net/lwg/issue998
        // http://wg21.cmeerw.net/lwg/issue2262
        T oldObject = fObject;
        fObject = object;
        SkCFSafeRelease(oldObject);
    }

    /**
     *  Shares the new object by calling CFRetain() on it. If this sk_cfp previously had a
     *  reference to an object (i.e. not null) it will call CFRelease() on that object.
     */
    void retain(T object) {
        if (fObject != object) {
            this->reset(SkCFSafeRetain(object));
        }
    }

    /**
     *  Return the original object, and set the internal object to nullptr.
     *  The caller must assume ownership of the object, and manage its reference count directly.
     *  No call to CFRelease() will be made.
     */
    T SK_WARN_UNUSED_RESULT release() {
        T obj = fObject;
        fObject = nil;
        return obj;
    }

private:
    T fObject = nil;
};

template <typename T> inline bool operator==(const sk_cfp<T>& a,
                                             const sk_cfp<T>& b) {
    return a.get() == b.get();
}
template <typename T> inline bool operator==(const sk_cfp<T>& a,
                                             std::nullptr_t) {
    return !a;
}
template <typename T> inline bool operator==(std::nullptr_t,
                                             const sk_cfp<T>& b) {
    return !b;
}

template <typename T> inline bool operator!=(const sk_cfp<T>& a,
                                             const sk_cfp<T>& b) {
    return a.get() != b.get();
}
template <typename T> inline bool operator!=(const sk_cfp<T>& a,
                                             std::nullptr_t) {
    return static_cast<bool>(a);
}
template <typename T> inline bool operator!=(std::nullptr_t,
                                             const sk_cfp<T>& b) {
    return static_cast<bool>(b);
}

/*
 *  Returns a sk_cfp wrapping the provided object AND calls retain on it (if not null).
 *
 *  This is different than the semantics of the constructor for sk_cfp, which just wraps the
 *  object, effectively "adopting" it.
 */
template <typename T> sk_cfp<T> sk_ret_cfp(T obj) {
    return sk_cfp<T>(SkCFSafeRetain(obj));
}

// For Flutter.
// TODO: migrate them away from this and remove
template <typename T> using sk_cf_obj = sk_cfp<T>;

#endif  // __APPLE__
#endif  // SkCFObject_DEFINED
