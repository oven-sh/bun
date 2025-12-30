/*
 * ISO C Standard:  7.22  Type-generic math <tgmath.h>
 */

#ifndef _TGMATH_H
#define _TGMATH_H

#include <math.h>

#ifndef __cplusplus
#define __tgmath_real(x, F)                                                    \
  _Generic((x), float: F##f, long double: F##l, default: F)(x)
#define __tgmath_real_2_1(x, y, F)                                             \
  _Generic((x), float: F##f, long double: F##l, default: F)(x, y)
#define __tgmath_real_2(x, y, F)                                               \
  _Generic((x) + (y), float: F##f, long double: F##l, default: F)(x, y)
#define __tgmath_real_3_2(x, y, z, F)                                          \
  _Generic((x) + (y), float: F##f, long double: F##l, default: F)(x, y, z)
#define __tgmath_real_3(x, y, z, F)                                            \
  _Generic((x) + (y) + (z), float: F##f, long double: F##l, default: F)(x, y, z)

/* Functions defined in both <math.h> and <complex.h> (7.22p4) */
#define acos(z) __tgmath_real(z, acos)
#define asin(z) __tgmath_real(z, asin)
#define atan(z) __tgmath_real(z, atan)
#define acosh(z) __tgmath_real(z, acosh)
#define asinh(z) __tgmath_real(z, asinh)
#define atanh(z) __tgmath_real(z, atanh)
#define cos(z) __tgmath_real(z, cos)
#define sin(z) __tgmath_real(z, sin)
#define tan(z) __tgmath_real(z, tan)
#define cosh(z) __tgmath_real(z, cosh)
#define sinh(z) __tgmath_real(z, sinh)
#define tanh(z) __tgmath_real(z, tanh)
#define exp(z) __tgmath_real(z, exp)
#define log(z) __tgmath_real(z, log)
#define pow(z1, z2) __tgmath_real_2(z1, z2, pow)
#define sqrt(z) __tgmath_real(z, sqrt)
#define fabs(z) __tgmath_real(z, fabs)

/* Functions defined in <math.h> only (7.22p5) */
#define atan2(x, y) __tgmath_real_2(x, y, atan2)
#define cbrt(x) __tgmath_real(x, cbrt)
#define ceil(x) __tgmath_real(x, ceil)
#define copysign(x, y) __tgmath_real_2(x, y, copysign)
#define erf(x) __tgmath_real(x, erf)
#define erfc(x) __tgmath_real(x, erfc)
#define exp2(x) __tgmath_real(x, exp2)
#define expm1(x) __tgmath_real(x, expm1)
#define fdim(x, y) __tgmath_real_2(x, y, fdim)
#define floor(x) __tgmath_real(x, floor)
#define fma(x, y, z) __tgmath_real_3(x, y, z, fma)
#define fmax(x, y) __tgmath_real_2(x, y, fmax)
#define fmin(x, y) __tgmath_real_2(x, y, fmin)
#define fmod(x, y) __tgmath_real_2(x, y, fmod)
#define frexp(x, y) __tgmath_real_2_1(x, y, frexp)
#define hypot(x, y) __tgmath_real_2(x, y, hypot)
#define ilogb(x) __tgmath_real(x, ilogb)
#define ldexp(x, y) __tgmath_real_2_1(x, y, ldexp)
#define lgamma(x) __tgmath_real(x, lgamma)
#define llrint(x) __tgmath_real(x, llrint)
#define llround(x) __tgmath_real(x, llround)
#define log10(x) __tgmath_real(x, log10)
#define log1p(x) __tgmath_real(x, log1p)
#define log2(x) __tgmath_real(x, log2)
#define logb(x) __tgmath_real(x, logb)
#define lrint(x) __tgmath_real(x, lrint)
#define lround(x) __tgmath_real(x, lround)
#define nearbyint(x) __tgmath_real(x, nearbyint)
#define nextafter(x, y) __tgmath_real_2(x, y, nextafter)
#define nexttoward(x, y) __tgmath_real_2(x, y, nexttoward)
#define remainder(x, y) __tgmath_real_2(x, y, remainder)
#define remquo(x, y, z) __tgmath_real_3_2(x, y, z, remquo)
#define rint(x) __tgmath_real(x, rint)
#define round(x) __tgmath_real(x, round)
#define scalbln(x, y) __tgmath_real_2_1(x, y, scalbln)
#define scalbn(x, y) __tgmath_real_2_1(x, y, scalbn)
#define tgamma(x) __tgmath_real(x, tgamma)
#define trunc(x) __tgmath_real(x, trunc)

/* Functions defined in <complex.h> only (7.22p6)
#define carg(z)          __tgmath_cplx_only(z, carg)
#define cimag(z)         __tgmath_cplx_only(z, cimag)
#define conj(z)          __tgmath_cplx_only(z, conj)
#define cproj(z)         __tgmath_cplx_only(z, cproj)
#define creal(z)         __tgmath_cplx_only(z, creal)
*/
#endif /* __cplusplus */
#endif /* _TGMATH_H */
