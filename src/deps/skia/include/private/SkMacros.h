/*
 * Copyright 2018 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */
#ifndef SkMacros_DEFINED
#define SkMacros_DEFINED

/*
 *  Usage:  SK_MACRO_CONCAT(a, b)   to construct the symbol ab
 *
 *  SK_MACRO_CONCAT_IMPL_PRIV just exists to make this work. Do not use directly
 *
 */
#define SK_MACRO_CONCAT(X, Y)           SK_MACRO_CONCAT_IMPL_PRIV(X, Y)
#define SK_MACRO_CONCAT_IMPL_PRIV(X, Y)  X ## Y

/*
 *  Usage: SK_MACRO_APPEND_LINE(foo)    to make foo123, where 123 is the current
 *                                      line number. Easy way to construct
 *                                      unique names for local functions or
 *                                      variables.
 */
#define SK_MACRO_APPEND_LINE(name)  SK_MACRO_CONCAT(name, __LINE__)

#define SK_MACRO_APPEND_COUNTER(name) SK_MACRO_CONCAT(name, __COUNTER__)

////////////////////////////////////////////////////////////////////////////////

// Can be used to bracket data types that must be dense, e.g. hash keys.
#if defined(__clang__)  // This should work on GCC too, but GCC diagnostic pop didn't seem to work!
    #define SK_BEGIN_REQUIRE_DENSE _Pragma("GCC diagnostic push") \
                                   _Pragma("GCC diagnostic error \"-Wpadded\"")
    #define SK_END_REQUIRE_DENSE   _Pragma("GCC diagnostic pop")
#else
    #define SK_BEGIN_REQUIRE_DENSE
    #define SK_END_REQUIRE_DENSE
#endif

#define SK_INIT_TO_AVOID_WARNING    = 0

////////////////////////////////////////////////////////////////////////////////

/**
 * Defines overloaded bitwise operators to make it easier to use an enum as a
 * bitfield.
 */
#define SK_MAKE_BITFIELD_OPS(X) \
    inline X operator |(X a, X b) { \
        return (X) (+a | +b); \
    } \
    inline X& operator |=(X& a, X b) { \
        return (a = a | b); \
    } \
    inline X operator &(X a, X b) { \
        return (X) (+a & +b); \
    } \
    inline X& operator &=(X& a, X b) { \
        return (a = a & b); \
    } \
    template <typename T> \
    inline X operator &(T a, X b) { \
        return (X) (+a & +b); \
    } \
    template <typename T> \
    inline X operator &(X a, T b) { \
        return (X) (+a & +b); \
    } \

#define SK_DECL_BITFIELD_OPS_FRIENDS(X) \
    friend X operator |(X a, X b); \
    friend X& operator |=(X& a, X b); \
    \
    friend X operator &(X a, X b); \
    friend X& operator &=(X& a, X b); \
    \
    template <typename T> \
    friend X operator &(T a, X b); \
    \
    template <typename T> \
    friend X operator &(X a, T b); \

#endif  // SkMacros_DEFINED
