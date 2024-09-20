/* This file is derived from clang's stdatomic.h */

/*===---- stdatomic.h - Standard header for atomic types and operations -----===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

#ifndef _STDATOMIC_H
#define _STDATOMIC_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define __ATOMIC_RELAXED 0
#define __ATOMIC_CONSUME 1
#define __ATOMIC_ACQUIRE 2
#define __ATOMIC_RELEASE 3
#define __ATOMIC_ACQ_REL 4
#define __ATOMIC_SEQ_CST 5

/* Memory ordering */
typedef enum {
  memory_order_relaxed = __ATOMIC_RELAXED,
  memory_order_consume = __ATOMIC_CONSUME,
  memory_order_acquire = __ATOMIC_ACQUIRE,
  memory_order_release = __ATOMIC_RELEASE,
  memory_order_acq_rel = __ATOMIC_ACQ_REL,
  memory_order_seq_cst = __ATOMIC_SEQ_CST,
} memory_order;

/* Atomic typedefs */
typedef _Atomic(_Bool) atomic_bool;
typedef _Atomic(char) atomic_char;
typedef _Atomic(signed char) atomic_schar;
typedef _Atomic(unsigned char) atomic_uchar;
typedef _Atomic(short) atomic_short;
typedef _Atomic(unsigned short) atomic_ushort;
typedef _Atomic(int) atomic_int;
typedef _Atomic(unsigned int) atomic_uint;
typedef _Atomic(long) atomic_long;
typedef _Atomic(unsigned long) atomic_ulong;
typedef _Atomic(long long) atomic_llong;
typedef _Atomic(unsigned long long) atomic_ullong;
typedef _Atomic(uint_least16_t) atomic_char16_t;
typedef _Atomic(uint_least32_t) atomic_char32_t;
typedef _Atomic(wchar_t) atomic_wchar_t;
typedef _Atomic(int_least8_t) atomic_int_least8_t;
typedef _Atomic(uint_least8_t) atomic_uint_least8_t;
typedef _Atomic(int_least16_t) atomic_int_least16_t;
typedef _Atomic(uint_least16_t) atomic_uint_least16_t;
typedef _Atomic(int_least32_t) atomic_int_least32_t;
typedef _Atomic(uint_least32_t) atomic_uint_least32_t;
typedef _Atomic(int_least64_t) atomic_int_least64_t;
typedef _Atomic(uint_least64_t) atomic_uint_least64_t;
typedef _Atomic(int_fast8_t) atomic_int_fast8_t;
typedef _Atomic(uint_fast8_t) atomic_uint_fast8_t;
typedef _Atomic(int_fast16_t) atomic_int_fast16_t;
typedef _Atomic(uint_fast16_t) atomic_uint_fast16_t;
typedef _Atomic(int_fast32_t) atomic_int_fast32_t;
typedef _Atomic(uint_fast32_t) atomic_uint_fast32_t;
typedef _Atomic(int_fast64_t) atomic_int_fast64_t;
typedef _Atomic(uint_fast64_t) atomic_uint_fast64_t;
typedef _Atomic(intptr_t) atomic_intptr_t;
typedef _Atomic(uintptr_t) atomic_uintptr_t;
typedef _Atomic(size_t) atomic_size_t;
typedef _Atomic(ptrdiff_t) atomic_ptrdiff_t;
typedef _Atomic(intmax_t) atomic_intmax_t;
typedef _Atomic(uintmax_t) atomic_uintmax_t;

/* Atomic flag */
typedef struct {
  atomic_bool value;
} atomic_flag;

#define ATOMIC_FLAG_INIT {0}
#define ATOMIC_VAR_INIT(value) (value)

#define atomic_flag_test_and_set_explicit(object, order)                       \
  __atomic_test_and_set((void *)(&((object)->value)), order)
#define atomic_flag_test_and_set(object)                                       \
  atomic_flag_test_and_set_explicit(object, __ATOMIC_SEQ_CST)

#define atomic_flag_clear_explicit(object, order)                              \
  __atomic_clear((bool *)(&((object)->value)), order)
#define atomic_flag_clear(object)                                              \
  atomic_flag_clear_explicit(object, __ATOMIC_SEQ_CST)

/* Generic routines */
#define atomic_init(object, desired)                                           \
  atomic_store_explicit(object, desired, __ATOMIC_RELAXED)

#define atomic_store_explicit(object, desired, order)                          \
  ({                                                                           \
    __typeof__(object) ptr = (object);                                         \
    __typeof__(*ptr) tmp = (desired);                                          \
    __atomic_store(ptr, &tmp, (order));                                        \
  })
#define atomic_store(object, desired)                                          \
  atomic_store_explicit(object, desired, __ATOMIC_SEQ_CST)

#define atomic_load_explicit(object, order)                                    \
  ({                                                                           \
    __typeof__(object) ptr = (object);                                         \
    __typeof__(*ptr) tmp;                                                      \
    __atomic_load(ptr, &tmp, (order));                                         \
    tmp;                                                                       \
  })
#define atomic_load(object) atomic_load_explicit(object, __ATOMIC_SEQ_CST)

#define atomic_exchange_explicit(object, desired, order)                       \
  ({                                                                           \
    __typeof__(object) ptr = (object);                                         \
    __typeof__(*ptr) val = (desired);                                          \
    __typeof__(*ptr) tmp;                                                      \
    __atomic_exchange(ptr, &val, &tmp, (order));                               \
    tmp;                                                                       \
  })
#define atomic_exchange(object, desired)                                       \
  atomic_exchange_explicit(object, desired, __ATOMIC_SEQ_CST)

#define atomic_compare_exchange_strong_explicit(object, expected, desired,     \
                                                success, failure)              \
  ({                                                                           \
    __typeof__(object) ptr = (object);                                         \
    __typeof__(*ptr) tmp = desired;                                            \
    __atomic_compare_exchange(ptr, expected, &tmp, 0, success, failure);       \
  })
#define atomic_compare_exchange_strong(object, expected, desired)              \
  atomic_compare_exchange_strong_explicit(object, expected, desired,           \
                                          __ATOMIC_SEQ_CST, __ATOMIC_SEQ_CST)

#define atomic_compare_exchange_weak_explicit(object, expected, desired,       \
                                              success, failure)                \
  ({                                                                           \
    __typeof__(object) ptr = (object);                                         \
    __typeof__(*ptr) tmp = desired;                                            \
    __atomic_compare_exchange(ptr, expected, &tmp, 1, success, failure);       \
  })
#define atomic_compare_exchange_weak(object, expected, desired)                \
  atomic_compare_exchange_weak_explicit(object, expected, desired,             \
                                        __ATOMIC_SEQ_CST, __ATOMIC_SEQ_CST)

#define atomic_fetch_add(object, operand)                                      \
  __atomic_fetch_add(object, operand, __ATOMIC_SEQ_CST)
#define atomic_fetch_add_explicit __atomic_fetch_add

#define atomic_fetch_sub(object, operand)                                      \
  __atomic_fetch_sub(object, operand, __ATOMIC_SEQ_CST)
#define atomic_fetch_sub_explicit __atomic_fetch_sub

#define atomic_fetch_or(object, operand)                                       \
  __atomic_fetch_or(object, operand, __ATOMIC_SEQ_CST)
#define atomic_fetch_or_explicit __atomic_fetch_or

#define atomic_fetch_xor(object, operand)                                      \
  __atomic_fetch_xor(object, operand, __ATOMIC_SEQ_CST)
#define atomic_fetch_xor_explicit __atomic_fetch_xor

#define atomic_fetch_and(object, operand)                                      \
  __atomic_fetch_and(object, operand, __ATOMIC_SEQ_CST)
#define atomic_fetch_and_explicit __atomic_fetch_and

extern void atomic_thread_fence(memory_order);
extern void __atomic_thread_fence(memory_order);
#define atomic_thread_fence(order) __atomic_thread_fence(order)
extern void atomic_signal_fence(memory_order);
extern void __atomic_signal_fence(memory_order);
#define atomic_signal_fence(order) __atomic_signal_fence(order)
extern bool __atomic_is_lock_free(size_t size, void *ptr);
#define atomic_is_lock_free(OBJ) __atomic_is_lock_free(sizeof(*(OBJ)), (OBJ))

extern bool __atomic_test_and_set(void *, memory_order);
extern void __atomic_clear(bool *, memory_order);

#endif /* _STDATOMIC_H */
