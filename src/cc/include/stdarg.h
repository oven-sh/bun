/* Variable arguments (C11 7.16). */
#ifndef __BUN_CC_STDARG_H
#define __BUN_CC_STDARG_H

typedef __builtin_va_list va_list;
typedef __builtin_va_list __gnuc_va_list;
#define __GNUC_VA_LIST 1

#define va_start(ap, ...) __builtin_va_start(ap __VA_OPT__(,) __VA_ARGS__)
#define va_arg(ap, type) __builtin_va_arg(ap, type)
#define va_end(ap) __builtin_va_end(ap)
#define va_copy(dest, src) __builtin_va_copy(dest, src)

#endif

#undef __need___va_list
