/* What C11 Annex G (G.5.1) asks of `*` and `/` on complex numbers beyond the formulas: when both
   parts of a result come out as NaNs, an operand that was infinite makes the result infinite (or
   zero), and one divided by zero is infinite. The compiler brings this in at the end of a file
   that multiplies or divides complex numbers, and calls one of these only when both parts of what
   the formula gave are NaNs. Every name is reserved. */
#define __BUN_CC_COMPLEX_RECOVERY(__T, __name, __copysign, __infinity) \
  static __T _Complex __bun_cc_complex_multiply_##__name(__T __a, __T __b, __T __c, __T __d) { \
    __T __ac = __a * __c, __bd = __b * __d, __ad = __a * __d, __bc = __b * __c; \
    __T __x = __ac - __bd, __y = __ad + __bc; \
    int __again = 0; \
    if (__builtin_isinf(__a) || __builtin_isinf(__b)) { \
      __a = __copysign(__builtin_isinf(__a) ? 1 : 0, __a); \
      __b = __copysign(__builtin_isinf(__b) ? 1 : 0, __b); \
      if (__c != __c) __c = __copysign(0, __c); \
      if (__d != __d) __d = __copysign(0, __d); \
      __again = 1; \
    } \
    if (__builtin_isinf(__c) || __builtin_isinf(__d)) { \
      __c = __copysign(__builtin_isinf(__c) ? 1 : 0, __c); \
      __d = __copysign(__builtin_isinf(__d) ? 1 : 0, __d); \
      if (__a != __a) __a = __copysign(0, __a); \
      if (__b != __b) __b = __copysign(0, __b); \
      __again = 1; \
    } \
    if (!__again && (__builtin_isinf(__ac) || __builtin_isinf(__bd) || __builtin_isinf(__ad) || __builtin_isinf(__bc))) { \
      if (__a != __a) __a = __copysign(0, __a); \
      if (__b != __b) __b = __copysign(0, __b); \
      if (__c != __c) __c = __copysign(0, __c); \
      if (__d != __d) __d = __copysign(0, __d); \
      __again = 1; \
    } \
    if (__again) { \
      __x = __infinity * (__a * __c - __b * __d); \
      __y = __infinity * (__a * __d + __b * __c); \
    } \
    return __builtin_complex(__x, __y); \
  } \
  static __T _Complex __bun_cc_complex_divide_##__name(__T __a, __T __b, __T __c, __T __d) { \
    __T __x = __a - __a + __infinity - __infinity, __y = __x; \
    int __finite_divisor = !__builtin_isinf(__c) && !__builtin_isinf(__d) && __c == __c && __d == __d; \
    int __finite_dividend = !__builtin_isinf(__a) && !__builtin_isinf(__b) && __a == __a && __b == __b; \
    if (__c == 0 && __d == 0 && (__a == __a || __b == __b)) { \
      __x = __copysign(__infinity, __c) * __a; \
      __y = __copysign(__infinity, __c) * __b; \
    } else if ((__builtin_isinf(__a) || __builtin_isinf(__b)) && __finite_divisor) { \
      __a = __copysign(__builtin_isinf(__a) ? 1 : 0, __a); \
      __b = __copysign(__builtin_isinf(__b) ? 1 : 0, __b); \
      __x = __infinity * (__a * __c + __b * __d); \
      __y = __infinity * (__b * __c - __a * __d); \
    } else if ((__builtin_isinf(__c) || __builtin_isinf(__d)) && __finite_dividend) { \
      __c = __copysign(__builtin_isinf(__c) ? 1 : 0, __c); \
      __d = __copysign(__builtin_isinf(__d) ? 1 : 0, __d); \
      __x = 0 * (__a * __c + __b * __d); \
      __y = 0 * (__b * __c - __a * __d); \
    } \
    return __builtin_complex(__x, __y); \
  }
__BUN_CC_COMPLEX_RECOVERY(float, float, __builtin_copysignf, __builtin_inff())
__BUN_CC_COMPLEX_RECOVERY(double, double, __builtin_copysign, __builtin_inf())
#undef __BUN_CC_COMPLEX_RECOVERY
