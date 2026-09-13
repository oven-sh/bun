/* Common definitions (C11 7.19). */
#ifndef __BUN_CC_STDDEF_H
#define __BUN_CC_STDDEF_H

typedef __PTRDIFF_TYPE__ ptrdiff_t;
typedef __SIZE_TYPE__ size_t;
typedef __WCHAR_TYPE__ wchar_t;
typedef union { long long __ll; double __d; void *__p; } max_align_t;
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

#undef __need_size_t
#undef __need_ptrdiff_t
#undef __need_wchar_t
#undef __need_NULL
#undef __need_wint_t
