/*
 * Copyright 2014 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

// EXPERIMENTAL EXPERIMENTAL EXPERIMENTAL EXPERIMENTAL
// DO NOT USE -- FOR INTERNAL TESTING ONLY

#ifndef sk_data_DEFINED
#define sk_data_DEFINED

#include "include/c/sk_types.h"

SK_C_PLUS_PLUS_BEGIN_GUARD

/**
    Returns a new sk_data_t by copying the specified source data.
    This call must be balanced with a call to sk_data_unref().
*/
SK_API sk_data_t* sk_data_new_with_copy(const void* src, size_t length);
/**
    Pass ownership of the given memory to a new sk_data_t, which will
    call free() when the refernce count of the data goes to zero.  For
    example:
        size_t length = 1024;
        void* buffer = malloc(length);
        memset(buffer, 'X', length);
        sk_data_t* data = sk_data_new_from_malloc(buffer, length);
    This call must be balanced with a call to sk_data_unref().
*/
SK_API sk_data_t* sk_data_new_from_malloc(const void* memory, size_t length);
/**
    Returns a new sk_data_t using a subset of the data in the
    specified source sk_data_t.  This call must be balanced with a
    call to sk_data_unref().
*/
SK_API sk_data_t* sk_data_new_subset(const sk_data_t* src, size_t offset, size_t length);

/**
    Increment the reference count on the given sk_data_t. Must be
    balanced by a call to sk_data_unref().
*/
SK_API void sk_data_ref(const sk_data_t*);
/**
    Decrement the reference count. If the reference count is 1 before
    the decrement, then release both the memory holding the sk_data_t
    and the memory it is managing.  New sk_data_t are created with a
    reference count of 1.
*/
SK_API void sk_data_unref(const sk_data_t*);

/**
    Returns the number of bytes stored.
*/
SK_API size_t sk_data_get_size(const sk_data_t*);
/**
    Returns the pointer to the data.
 */
SK_API const void* sk_data_get_data(const sk_data_t*);

SK_C_PLUS_PLUS_END_GUARD

#endif
