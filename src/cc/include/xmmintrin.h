/* SSE intrinsics for x86-64 targets, written over the vector extensions. Only what is
   defined here exists. */
#ifndef __BUN_CC_XMMINTRIN_H
#define __BUN_CC_XMMINTRIN_H

typedef float __m128 __attribute__((__vector_size__(16)));
typedef float __m128_u __attribute__((__vector_size__(16)));

typedef float __v4sf __attribute__((__vector_size__(16)));
typedef int __v4si __attribute__((__vector_size__(16)));
typedef unsigned int __v4su __attribute__((__vector_size__(16)));

#define __BUN_CC_INTRIN static __inline __attribute__((__always_inline__, __unused__))

#define _MM_SHUFFLE(z, y, x, w) (((z) << 6) | ((y) << 4) | ((x) << 2) | (w))

__BUN_CC_INTRIN __m128 _mm_setzero_ps(void) { return (__m128) { 0.0f, 0.0f, 0.0f, 0.0f }; }
__BUN_CC_INTRIN __m128 _mm_set1_ps(float __w) { return (__m128) { __w, __w, __w, __w }; }
__BUN_CC_INTRIN __m128 _mm_set_ps1(float __w) { return (__m128) { __w, __w, __w, __w }; }
__BUN_CC_INTRIN __m128 _mm_set_ps(float __z, float __y, float __x, float __w) { return (__m128) { __w, __x, __y, __z }; }
__BUN_CC_INTRIN __m128 _mm_setr_ps(float __z, float __y, float __x, float __w) { return (__m128) { __z, __y, __x, __w }; }
__BUN_CC_INTRIN __m128 _mm_set_ss(float __w) { return (__m128) { __w, 0.0f, 0.0f, 0.0f }; }

__BUN_CC_INTRIN __m128 _mm_load_ps(const float* __p) { return *(const __m128*)__p; }
__BUN_CC_INTRIN __m128 _mm_loadu_ps(const float* __p) { return *(const __m128_u*)__p; }
__BUN_CC_INTRIN __m128 _mm_load1_ps(const float* __p) { return _mm_set1_ps(*__p); }
__BUN_CC_INTRIN __m128 _mm_load_ss(const float* __p) { return _mm_set_ss(*__p); }
__BUN_CC_INTRIN void _mm_store_ps(float* __p, __m128 __a) { *(__m128*)__p = __a; }
__BUN_CC_INTRIN void _mm_storeu_ps(float* __p, __m128 __a) { *(__m128_u*)__p = __a; }
__BUN_CC_INTRIN void _mm_store_ss(float* __p, __m128 __a) { *__p = __a[0]; }
__BUN_CC_INTRIN float _mm_cvtss_f32(__m128 __a) { return __a[0]; }

__BUN_CC_INTRIN __m128 _mm_add_ps(__m128 __a, __m128 __b) { return __a + __b; }
__BUN_CC_INTRIN __m128 _mm_sub_ps(__m128 __a, __m128 __b) { return __a - __b; }
__BUN_CC_INTRIN __m128 _mm_mul_ps(__m128 __a, __m128 __b) { return __a * __b; }
__BUN_CC_INTRIN __m128 _mm_div_ps(__m128 __a, __m128 __b) { return __a / __b; }
__BUN_CC_INTRIN __m128 _mm_sqrt_ps(__m128 __a) { return __builtin_elementwise_sqrt(__a); }
__BUN_CC_INTRIN __m128 _mm_min_ps(__m128 __a, __m128 __b) { return __builtin_elementwise_min(__a, __b); }
__BUN_CC_INTRIN __m128 _mm_max_ps(__m128 __a, __m128 __b) { return __builtin_elementwise_max(__a, __b); }

__BUN_CC_INTRIN __m128 _mm_and_ps(__m128 __a, __m128 __b) { return (__m128)((__v4su)__a & (__v4su)__b); }
__BUN_CC_INTRIN __m128 _mm_andnot_ps(__m128 __a, __m128 __b) { return (__m128)(~(__v4su)__a & (__v4su)__b); }
__BUN_CC_INTRIN __m128 _mm_or_ps(__m128 __a, __m128 __b) { return (__m128)((__v4su)__a | (__v4su)__b); }
__BUN_CC_INTRIN __m128 _mm_xor_ps(__m128 __a, __m128 __b) { return (__m128)((__v4su)__a ^ (__v4su)__b); }

__BUN_CC_INTRIN __m128 _mm_cmpeq_ps(__m128 __a, __m128 __b) { return (__m128)(__a == __b); }
__BUN_CC_INTRIN __m128 _mm_cmplt_ps(__m128 __a, __m128 __b) { return (__m128)(__a < __b); }
__BUN_CC_INTRIN __m128 _mm_cmple_ps(__m128 __a, __m128 __b) { return (__m128)(__a <= __b); }
__BUN_CC_INTRIN __m128 _mm_cmpgt_ps(__m128 __a, __m128 __b) { return (__m128)(__a > __b); }
__BUN_CC_INTRIN __m128 _mm_cmpge_ps(__m128 __a, __m128 __b) { return (__m128)(__a >= __b); }
__BUN_CC_INTRIN __m128 _mm_cmpneq_ps(__m128 __a, __m128 __b) { return (__m128)(__a != __b); }

__BUN_CC_INTRIN int _mm_movemask_ps(__m128 __a) { return __builtin_ia32_movmskps(__a); }

#define _mm_shuffle_ps(a, b, mask)                                                                            \
    ((__m128)__builtin_shufflevector((__v4sf)(__m128)(a), (__v4sf)(__m128)(b), (mask) & 3, ((mask) >> 2) & 3, \
        4 + (((mask) >> 4) & 3), 4 + (((mask) >> 6) & 3)))

__BUN_CC_INTRIN __m128 _mm_unpacklo_ps(__m128 __a, __m128 __b) { return __builtin_shufflevector(__a, __b, 0, 4, 1, 5); }
__BUN_CC_INTRIN __m128 _mm_unpackhi_ps(__m128 __a, __m128 __b) { return __builtin_shufflevector(__a, __b, 2, 6, 3, 7); }
__BUN_CC_INTRIN __m128 _mm_movehl_ps(__m128 __a, __m128 __b) { return __builtin_shufflevector(__a, __b, 6, 7, 2, 3); }
__BUN_CC_INTRIN __m128 _mm_movelh_ps(__m128 __a, __m128 __b) { return __builtin_shufflevector(__a, __b, 0, 1, 4, 5); }

/* Scalar single-precision: lane 0 is computed, the other lanes come from the first operand. */

__BUN_CC_INTRIN __m128 _mm_add_ss(__m128 __a, __m128 __b)
{
    __a[0] = __a[0] + __b[0];
    return __a;
}
__BUN_CC_INTRIN __m128 _mm_sub_ss(__m128 __a, __m128 __b)
{
    __a[0] = __a[0] - __b[0];
    return __a;
}
__BUN_CC_INTRIN __m128 _mm_mul_ss(__m128 __a, __m128 __b)
{
    __a[0] = __a[0] * __b[0];
    return __a;
}
__BUN_CC_INTRIN __m128 _mm_div_ss(__m128 __a, __m128 __b)
{
    __a[0] = __a[0] / __b[0];
    return __a;
}
__BUN_CC_INTRIN __m128 _mm_sqrt_ss(__m128 __a)
{
    __a[0] = __builtin_elementwise_sqrt(__a)[0];
    return __a;
}
__BUN_CC_INTRIN __m128 _mm_min_ss(__m128 __a, __m128 __b)
{
    __a[0] = __builtin_elementwise_min(__a, __b)[0];
    return __a;
}
__BUN_CC_INTRIN __m128 _mm_max_ss(__m128 __a, __m128 __b)
{
    __a[0] = __builtin_elementwise_max(__a, __b)[0];
    return __a;
}
__BUN_CC_INTRIN __m128 _mm_move_ss(__m128 __a, __m128 __b)
{
    __a[0] = __b[0];
    return __a;
}
/* The hardware gives 12-bit approximations; these are exact. */
__BUN_CC_INTRIN __m128 _mm_rcp_ps(__m128 __a) { return (__m128) { 1.0f, 1.0f, 1.0f, 1.0f } / __a; }
__BUN_CC_INTRIN __m128 _mm_rsqrt_ps(__m128 __a) { return (__m128) { 1.0f, 1.0f, 1.0f, 1.0f } / __builtin_elementwise_sqrt(__a); }
__BUN_CC_INTRIN __m128 _mm_rcp_ss(__m128 __a)
{
    __a[0] = 1.0f / __a[0];
    return __a;
}
__BUN_CC_INTRIN __m128 _mm_rsqrt_ss(__m128 __a)
{
    __a[0] = 1.0f / __builtin_elementwise_sqrt(__a)[0];
    return __a;
}

__BUN_CC_INTRIN __m128 _mm_cmpnlt_ps(__m128 __a, __m128 __b) { return (__m128) ~(__v4si)(__a < __b); }
__BUN_CC_INTRIN __m128 _mm_cmpnle_ps(__m128 __a, __m128 __b) { return (__m128) ~(__v4si)(__a <= __b); }
__BUN_CC_INTRIN __m128 _mm_cmpngt_ps(__m128 __a, __m128 __b) { return (__m128) ~(__v4si)(__a > __b); }
__BUN_CC_INTRIN __m128 _mm_cmpnge_ps(__m128 __a, __m128 __b) { return (__m128) ~(__v4si)(__a >= __b); }
__BUN_CC_INTRIN __m128 _mm_cmpord_ps(__m128 __a, __m128 __b) { return (__m128)((__v4si)(__a == __a) & (__v4si)(__b == __b)); }
__BUN_CC_INTRIN __m128 _mm_cmpunord_ps(__m128 __a, __m128 __b) { return (__m128) ~((__v4si)(__a == __a) & (__v4si)(__b == __b)); }
#define __BUN_CC_CMP_SS(name)                                         \
    __BUN_CC_INTRIN __m128 _mm_cmp##name##_ss(__m128 __a, __m128 __b) \
    {                                                                 \
        __m128 __c = _mm_cmp##name##_ps(__a, __b);                    \
        __a[0] = __c[0];                                              \
        return __a;                                                   \
    }
__BUN_CC_CMP_SS(eq)
__BUN_CC_CMP_SS(lt) __BUN_CC_CMP_SS(le) __BUN_CC_CMP_SS(gt) __BUN_CC_CMP_SS(ge) __BUN_CC_CMP_SS(neq)
    __BUN_CC_CMP_SS(nlt) __BUN_CC_CMP_SS(nle) __BUN_CC_CMP_SS(ngt) __BUN_CC_CMP_SS(nge) __BUN_CC_CMP_SS(ord) __BUN_CC_CMP_SS(unord)
#undef __BUN_CC_CMP_SS

        __BUN_CC_INTRIN int _mm_comieq_ss(__m128 __a, __m128 __b)
{
    return __a[0] == __b[0];
}
__BUN_CC_INTRIN int _mm_comilt_ss(__m128 __a, __m128 __b) { return __a[0] < __b[0]; }
__BUN_CC_INTRIN int _mm_comile_ss(__m128 __a, __m128 __b) { return __a[0] <= __b[0]; }
__BUN_CC_INTRIN int _mm_comigt_ss(__m128 __a, __m128 __b) { return __a[0] > __b[0]; }
__BUN_CC_INTRIN int _mm_comige_ss(__m128 __a, __m128 __b) { return __a[0] >= __b[0]; }
__BUN_CC_INTRIN int _mm_comineq_ss(__m128 __a, __m128 __b) { return __a[0] != __b[0]; }
__BUN_CC_INTRIN int _mm_ucomieq_ss(__m128 __a, __m128 __b) { return __a[0] == __b[0]; }
__BUN_CC_INTRIN int _mm_ucomilt_ss(__m128 __a, __m128 __b) { return __a[0] < __b[0]; }
__BUN_CC_INTRIN int _mm_ucomile_ss(__m128 __a, __m128 __b) { return __a[0] <= __b[0]; }
__BUN_CC_INTRIN int _mm_ucomigt_ss(__m128 __a, __m128 __b) { return __a[0] > __b[0]; }
__BUN_CC_INTRIN int _mm_ucomige_ss(__m128 __a, __m128 __b) { return __a[0] >= __b[0]; }
__BUN_CC_INTRIN int _mm_ucomineq_ss(__m128 __a, __m128 __b) { return __a[0] != __b[0]; }

__BUN_CC_INTRIN __m128 _mm_cvtsi32_ss(__m128 __a, int __b)
{
    __a[0] = (float)__b;
    return __a;
}
__BUN_CC_INTRIN __m128 _mm_cvt_si2ss(__m128 __a, int __b)
{
    __a[0] = (float)__b;
    return __a;
}
__BUN_CC_INTRIN __m128 _mm_cvtsi64_ss(__m128 __a, long long __b)
{
    __a[0] = (float)__b;
    return __a;
}

__BUN_CC_INTRIN __m128 _mm_load_ps1(const float* __p) { return _mm_set1_ps(*__p); }
__BUN_CC_INTRIN __m128 _mm_loadr_ps(const float* __p)
{
    __m128 __a = *(const __m128*)__p;
    return __builtin_shufflevector(__a, __a, 3, 2, 1, 0);
}
__BUN_CC_INTRIN void _mm_store1_ps(float* __p, __m128 __a) { *(__m128*)__p = __builtin_shufflevector(__a, __a, 0, 0, 0, 0); }
__BUN_CC_INTRIN void _mm_store_ps1(float* __p, __m128 __a) { *(__m128*)__p = __builtin_shufflevector(__a, __a, 0, 0, 0, 0); }
__BUN_CC_INTRIN void _mm_storer_ps(float* __p, __m128 __a) { *(__m128*)__p = __builtin_shufflevector(__a, __a, 3, 2, 1, 0); }
/* A non-temporal store is an ordinary store here. */
__BUN_CC_INTRIN void _mm_stream_ps(float* __p, __m128 __a) { *(__m128*)__p = __a; }
__BUN_CC_INTRIN __m128 _mm_undefined_ps(void) { return (__m128) { 0.0f, 0.0f, 0.0f, 0.0f }; }
__BUN_CC_INTRIN void _mm_sfence(void) { __atomic_thread_fence(__ATOMIC_SEQ_CST); }

#define _MM_HINT_ET0 7
#define _MM_HINT_ET1 6
#define _MM_HINT_T0 3
#define _MM_HINT_T1 2
#define _MM_HINT_T2 1
#define _MM_HINT_NTA 0
#ifdef _MSC_VER
/* (A function there: <winnt.h> declares it again.) */
__BUN_CC_INTRIN void _mm_prefetch(const char* __p, int __hint) { (void)__p, (void)__hint; }
#else
#define _mm_prefetch(p, hint) ((void)(p), (void)(hint))
#endif

#endif
