/* Type-generic math (C11 7.25): each macro calls the function that matches its arguments' types. An argument of
   integer type counts as a double; with several arguments the widest decides. */
#ifndef __BUN_CC_TGMATH_H
#define __BUN_CC_TGMATH_H

#include <math.h>
/* (Microsoft's <complex.h> has structures where C has _Complex types: only the real functions there.) */
#ifndef _MSC_VER
#include <complex.h>
#define __BUN_CC_TG_COMPLEX 1
#endif

/* A value of the type the argument counts as. */
#ifdef __BUN_CC_TG_COMPLEX
/* (Where long double has double's format, long double _Complex is double _Complex: named once.) */
#if __SIZEOF_LONG_DOUBLE__ > __SIZEOF_DOUBLE__
#define __bun_cc_tg_ldc(...) long double _Complex: __VA_ARGS__,
#else
#define __bun_cc_tg_ldc(...)
#endif
#define __bun_cc_tg_as(x) _Generic((x), float: (float)0, long double: (long double)0, float _Complex: (float _Complex)0, \
  double _Complex: (double _Complex)0, __bun_cc_tg_ldc((long double _Complex)0) default: (double)0)
#define __bun_cc_tg_real_or_complex(name, selector, ...) _Generic((selector), float: name##f, long double: name##l, \
  float _Complex: c##name##f, double _Complex: c##name, __bun_cc_tg_ldc(c##name##l) default: name)(__VA_ARGS__)
#else
#define __bun_cc_tg_as(x) _Generic((x), float: (float)0, long double: (long double)0, default: (double)0)
#define __bun_cc_tg_real_or_complex(name, selector, ...) _Generic((selector), float: name##f, long double: name##l, default: name)(__VA_ARGS__)
#endif
#define __bun_cc_tg_real(name, selector, ...) _Generic((selector), float: name##f, long double: name##l, default: name)(__VA_ARGS__)
#define __bun_cc_tg_1(x) __bun_cc_tg_as(x)
#define __bun_cc_tg_2(x, y) (__bun_cc_tg_as(x) + __bun_cc_tg_as(y))
#define __bun_cc_tg_3(x, y, z) (__bun_cc_tg_as(x) + __bun_cc_tg_as(y) + __bun_cc_tg_as(z))

#undef acos
#define acos(x) __bun_cc_tg_real_or_complex(acos, __bun_cc_tg_1(x), x)
#undef asin
#define asin(x) __bun_cc_tg_real_or_complex(asin, __bun_cc_tg_1(x), x)
#undef atan
#define atan(x) __bun_cc_tg_real_or_complex(atan, __bun_cc_tg_1(x), x)
#undef acosh
#define acosh(x) __bun_cc_tg_real_or_complex(acosh, __bun_cc_tg_1(x), x)
#undef asinh
#define asinh(x) __bun_cc_tg_real_or_complex(asinh, __bun_cc_tg_1(x), x)
#undef atanh
#define atanh(x) __bun_cc_tg_real_or_complex(atanh, __bun_cc_tg_1(x), x)
#undef cos
#define cos(x) __bun_cc_tg_real_or_complex(cos, __bun_cc_tg_1(x), x)
#undef sin
#define sin(x) __bun_cc_tg_real_or_complex(sin, __bun_cc_tg_1(x), x)
#undef tan
#define tan(x) __bun_cc_tg_real_or_complex(tan, __bun_cc_tg_1(x), x)
#undef cosh
#define cosh(x) __bun_cc_tg_real_or_complex(cosh, __bun_cc_tg_1(x), x)
#undef sinh
#define sinh(x) __bun_cc_tg_real_or_complex(sinh, __bun_cc_tg_1(x), x)
#undef tanh
#define tanh(x) __bun_cc_tg_real_or_complex(tanh, __bun_cc_tg_1(x), x)
#undef exp
#define exp(x) __bun_cc_tg_real_or_complex(exp, __bun_cc_tg_1(x), x)
#undef log
#define log(x) __bun_cc_tg_real_or_complex(log, __bun_cc_tg_1(x), x)
#undef sqrt
#define sqrt(x) __bun_cc_tg_real_or_complex(sqrt, __bun_cc_tg_1(x), x)
#undef pow
#define pow(x, y) __bun_cc_tg_real_or_complex(pow, __bun_cc_tg_2(x, y), x, y)
#undef fabs
#ifdef __BUN_CC_TG_COMPLEX
#define fabs(x) _Generic(__bun_cc_tg_1(x), float: fabsf, long double: fabsl, float _Complex: cabsf, double _Complex: cabs, \
  __bun_cc_tg_ldc(cabsl) default: fabs)(x)
#else
#define fabs(x) __bun_cc_tg_real(fabs, __bun_cc_tg_1(x), x)
#endif
#undef cbrt
#define cbrt(x) __bun_cc_tg_real(cbrt, __bun_cc_tg_1(x), x)
#undef ceil
#define ceil(x) __bun_cc_tg_real(ceil, __bun_cc_tg_1(x), x)
#undef erf
#define erf(x) __bun_cc_tg_real(erf, __bun_cc_tg_1(x), x)
#undef erfc
#define erfc(x) __bun_cc_tg_real(erfc, __bun_cc_tg_1(x), x)
#undef exp2
#define exp2(x) __bun_cc_tg_real(exp2, __bun_cc_tg_1(x), x)
#undef expm1
#define expm1(x) __bun_cc_tg_real(expm1, __bun_cc_tg_1(x), x)
#undef floor
#define floor(x) __bun_cc_tg_real(floor, __bun_cc_tg_1(x), x)
#undef lgamma
#define lgamma(x) __bun_cc_tg_real(lgamma, __bun_cc_tg_1(x), x)
#undef log10
#define log10(x) __bun_cc_tg_real(log10, __bun_cc_tg_1(x), x)
#undef log1p
#define log1p(x) __bun_cc_tg_real(log1p, __bun_cc_tg_1(x), x)
#undef log2
#define log2(x) __bun_cc_tg_real(log2, __bun_cc_tg_1(x), x)
#undef logb
#define logb(x) __bun_cc_tg_real(logb, __bun_cc_tg_1(x), x)
#undef nearbyint
#define nearbyint(x) __bun_cc_tg_real(nearbyint, __bun_cc_tg_1(x), x)
#undef rint
#define rint(x) __bun_cc_tg_real(rint, __bun_cc_tg_1(x), x)
#undef round
#define round(x) __bun_cc_tg_real(round, __bun_cc_tg_1(x), x)
#undef tgamma
#define tgamma(x) __bun_cc_tg_real(tgamma, __bun_cc_tg_1(x), x)
#undef trunc
#define trunc(x) __bun_cc_tg_real(trunc, __bun_cc_tg_1(x), x)
#undef ilogb
#define ilogb(x) __bun_cc_tg_real(ilogb, __bun_cc_tg_1(x), x)
#undef llrint
#define llrint(x) __bun_cc_tg_real(llrint, __bun_cc_tg_1(x), x)
#undef llround
#define llround(x) __bun_cc_tg_real(llround, __bun_cc_tg_1(x), x)
#undef lrint
#define lrint(x) __bun_cc_tg_real(lrint, __bun_cc_tg_1(x), x)
#undef lround
#define lround(x) __bun_cc_tg_real(lround, __bun_cc_tg_1(x), x)
#undef atan2
#define atan2(x, y) __bun_cc_tg_real(atan2, __bun_cc_tg_2(x, y), x, y)
#undef copysign
#define copysign(x, y) __bun_cc_tg_real(copysign, __bun_cc_tg_2(x, y), x, y)
#undef fdim
#define fdim(x, y) __bun_cc_tg_real(fdim, __bun_cc_tg_2(x, y), x, y)
#undef fmax
#define fmax(x, y) __bun_cc_tg_real(fmax, __bun_cc_tg_2(x, y), x, y)
#undef fmin
#define fmin(x, y) __bun_cc_tg_real(fmin, __bun_cc_tg_2(x, y), x, y)
#undef fmod
#define fmod(x, y) __bun_cc_tg_real(fmod, __bun_cc_tg_2(x, y), x, y)
#undef hypot
#define hypot(x, y) __bun_cc_tg_real(hypot, __bun_cc_tg_2(x, y), x, y)
#undef nextafter
#define nextafter(x, y) __bun_cc_tg_real(nextafter, __bun_cc_tg_2(x, y), x, y)
#undef remainder
#define remainder(x, y) __bun_cc_tg_real(remainder, __bun_cc_tg_2(x, y), x, y)
#undef fma
#define fma(x, y, z) __bun_cc_tg_real(fma, __bun_cc_tg_3(x, y, z), x, y, z)
#undef remquo
#define remquo(x, y, q) __bun_cc_tg_real(remquo, __bun_cc_tg_2(x, y), x, y, q)
/* The second argument of these is not a floating one and does not count. */
#undef frexp
#define frexp(x, e) __bun_cc_tg_real(frexp, __bun_cc_tg_1(x), x, e)
#undef ldexp
#define ldexp(x, n) __bun_cc_tg_real(ldexp, __bun_cc_tg_1(x), x, n)
#undef scalbn
#define scalbn(x, n) __bun_cc_tg_real(scalbn, __bun_cc_tg_1(x), x, n)
#undef scalbln
#define scalbln(x, n) __bun_cc_tg_real(scalbln, __bun_cc_tg_1(x), x, n)
#undef nexttoward
#define nexttoward(x, y) __bun_cc_tg_real(nexttoward, __bun_cc_tg_1(x), x, y)

#ifdef __BUN_CC_TG_COMPLEX
/* For complex arguments only; a real one counts as a complex number of its kind. */
#define __bun_cc_tg_complex(name, x) _Generic(__bun_cc_tg_1(x), float: name##f, long double: name##l, float _Complex: name##f, \
  __bun_cc_tg_ldc(name##l) default: name)(x)
#undef carg
#define carg(x) __bun_cc_tg_complex(carg, x)
#undef cimag
#define cimag(x) __bun_cc_tg_complex(cimag, x)
#undef conj
#define conj(x) __bun_cc_tg_complex(conj, x)
#undef cproj
#define cproj(x) __bun_cc_tg_complex(cproj, x)
#undef creal
#define creal(x) __bun_cc_tg_complex(creal, x)
#endif

#endif
