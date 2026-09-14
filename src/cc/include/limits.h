/* Sizes of integer types (C11 7.10); the system <limits.h> adds the POSIX limits. */
#ifndef __BUN_CC_LIMITS_H
#define __BUN_CC_LIMITS_H

/* The system's <limits.h> tries to #include_next GCC's when it sees a GNU C compiler. */
#if defined __GNUC__ && !defined _GCC_LIMITS_H_
#define _GCC_LIMITS_H_
#endif

#if defined __has_include_next
#if __has_include_next(<limits.h>)
#include_next <limits.h>
#endif
#endif

#undef CHAR_BIT
#define CHAR_BIT __CHAR_BIT__
#undef MB_LEN_MAX
#define MB_LEN_MAX 16

#undef SCHAR_MIN
#define SCHAR_MIN (-__SCHAR_MAX__ - 1)
#undef SCHAR_MAX
#define SCHAR_MAX __SCHAR_MAX__
#undef UCHAR_MAX
#define UCHAR_MAX (__SCHAR_MAX__ * 2 + 1)

#undef CHAR_MIN
#undef CHAR_MAX
#ifdef __CHAR_UNSIGNED__
#define CHAR_MIN 0
#define CHAR_MAX UCHAR_MAX
#else
#define CHAR_MIN SCHAR_MIN
#define CHAR_MAX SCHAR_MAX
#endif

#undef SHRT_MIN
#define SHRT_MIN (-__SHRT_MAX__ - 1)
#undef SHRT_MAX
#define SHRT_MAX __SHRT_MAX__
#undef USHRT_MAX
#define USHRT_MAX (__SHRT_MAX__ * 2 + 1)

#undef INT_MIN
#define INT_MIN (-__INT_MAX__ - 1)
#undef INT_MAX
#define INT_MAX __INT_MAX__
#undef UINT_MAX
#define UINT_MAX (__INT_MAX__ * 2U + 1U)

#undef LONG_MIN
#define LONG_MIN (-__LONG_MAX__ - 1L)
#undef LONG_MAX
#define LONG_MAX __LONG_MAX__
#undef ULONG_MAX
#define ULONG_MAX (__LONG_MAX__ * 2UL + 1UL)

#undef LLONG_MIN
#define LLONG_MIN (-__LONG_LONG_MAX__ - 1LL)
#undef LLONG_MAX
#define LLONG_MAX __LONG_LONG_MAX__
#undef ULLONG_MAX
#define ULLONG_MAX (__LONG_LONG_MAX__ * 2ULL + 1ULL)

#endif
