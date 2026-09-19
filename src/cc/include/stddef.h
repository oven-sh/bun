/* Common definitions (C11 7.19). */
#ifndef __BUN_CC_STDDEF_H
#define __BUN_CC_STDDEF_H

/* Microsoft's own, where it is installed, is what its other headers are written against; it
   leaves out C11's max_align_t. */
#if defined(_MSC_VER) && defined(__has_include_next)
#if __has_include_next(<stddef.h>)
#define __BUN_CC_THEIR_STDDEF_H
#endif
#endif
#ifdef __BUN_CC_THEIR_STDDEF_H
#include_next <stddef.h>
typedef double max_align_t;
#else

typedef __PTRDIFF_TYPE__ ptrdiff_t;
typedef __SIZE_TYPE__ size_t;
typedef __WCHAR_TYPE__ wchar_t;
#ifdef __APPLE__
typedef long double max_align_t;
#else
typedef struct {
  long long __max_align_ll __attribute__((__aligned__(__alignof__(long long))));
  long double __max_align_ld __attribute__((__aligned__(__alignof__(long double))));
} max_align_t;
#endif
#ifdef _WIN32
/* The Windows C runtimes' <stddef.h> (Microsoft's through vcruntime.h, MinGW's and TinyCC's directly)
   also has these, and their other headers count on it. */
typedef __INTPTR_TYPE__ intptr_t;
typedef __UINTPTR_TYPE__ uintptr_t;
typedef __PTRDIFF_TYPE__ ssize_t;
#endif

#undef NULL
#define NULL ((void *)0)
#define offsetof(type, member) __builtin_offsetof(type, member)

#endif
#endif

#undef __need_size_t
#undef __need_ptrdiff_t
#undef __need_wchar_t
#undef __need_NULL
#undef __need_wint_t
