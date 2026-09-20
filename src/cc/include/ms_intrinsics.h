/* Microsoft's compiler intrinsics, each one written in C.

   This file is read two ways. Ahead of every translation unit for a Windows target, __BUN_MS
   defines `__bun_ms_<name>`, which is what a call to an intrinsic the program has declared
   (or that <intrin.h> has) and not defined goes to. From <intrin.h>, __BUN_MS declares `<name>`.

   `long` has 32 bits here. What needs an instruction that C has no way to say is inline
   assembly; what this compiler cannot do at all (a 16-byte compare and swap, reading the flags,
   stopping the processor) says so when it is compiled into a function that is used. */

/* Bits. */
__BUN_MS(unsigned char, _BitScanForward, (unsigned long *__index, unsigned long __mask), { if (!__mask) return 0; *__index = (unsigned long)__builtin_ctz(__mask); return 1; })
__BUN_MS(unsigned char, _BitScanReverse, (unsigned long *__index, unsigned long __mask), { if (!__mask) return 0; *__index = 31ul - (unsigned long)__builtin_clz(__mask); return 1; })
__BUN_MS(unsigned char, _BitScanForward64, (unsigned long *__index, unsigned __int64 __mask), { if (!__mask) return 0; *__index = (unsigned long)__builtin_ctzll(__mask); return 1; })
__BUN_MS(unsigned char, _BitScanReverse64, (unsigned long *__index, unsigned __int64 __mask), { if (!__mask) return 0; *__index = 63ul - (unsigned long)__builtin_clzll(__mask); return 1; })
__BUN_MS(unsigned short, __lzcnt16, (unsigned short __x), { return (unsigned short)(__x ? __builtin_clz(__x) - 16 : 16); })
__BUN_MS(unsigned int, __lzcnt, (unsigned int __x), { return __x ? (unsigned int)__builtin_clz(__x) : 32u; })
__BUN_MS(unsigned __int64, __lzcnt64, (unsigned __int64 __x), { return __x ? (unsigned __int64)__builtin_clzll(__x) : 64u; })
__BUN_MS(unsigned short, __popcnt16, (unsigned short __x), { return (unsigned short)__builtin_popcount(__x); })
__BUN_MS(unsigned int, __popcnt, (unsigned int __x), { return (unsigned int)__builtin_popcount(__x); })
__BUN_MS(unsigned __int64, __popcnt64, (unsigned __int64 __x), { return (unsigned __int64)__builtin_popcountll(__x); })
__BUN_MS(unsigned short, _byteswap_ushort, (unsigned short __x), { return __builtin_bswap16(__x); })
__BUN_MS(unsigned long, _byteswap_ulong, (unsigned long __x), { return __builtin_bswap32(__x); })
__BUN_MS(unsigned __int64, _byteswap_uint64, (unsigned __int64 __x), { return __builtin_bswap64(__x); })
__BUN_MS(unsigned char, _rotl8, (unsigned char __x, unsigned char __n), { return __builtin_rotateleft8(__x, __n); })
__BUN_MS(unsigned char, _rotr8, (unsigned char __x, unsigned char __n), { return __builtin_rotateright8(__x, __n); })
__BUN_MS(unsigned short, _rotl16, (unsigned short __x, unsigned char __n), { return __builtin_rotateleft16(__x, __n); })
__BUN_MS(unsigned short, _rotr16, (unsigned short __x, unsigned char __n), { return __builtin_rotateright16(__x, __n); })
__BUN_MS(unsigned int, _rotl, (unsigned int __x, int __n), { return __builtin_rotateleft32(__x, (unsigned int)__n); })
__BUN_MS(unsigned int, _rotr, (unsigned int __x, int __n), { return __builtin_rotateright32(__x, (unsigned int)__n); })
__BUN_MS(unsigned long, _lrotl, (unsigned long __x, int __n), { return __builtin_rotateleft32(__x, (unsigned int)__n); })
__BUN_MS(unsigned long, _lrotr, (unsigned long __x, int __n), { return __builtin_rotateright32(__x, (unsigned int)__n); })
__BUN_MS(unsigned __int64, _rotl64, (unsigned __int64 __x, int __n), { return __builtin_rotateleft64(__x, (unsigned int)__n); })
__BUN_MS(unsigned __int64, _rotr64, (unsigned __int64 __x, int __n), { return __builtin_rotateright64(__x, (unsigned int)__n); })
__BUN_MS(unsigned char, _bittest, (long const *__base, long __bit), { return (unsigned char)((__base[__bit >> 5] >> (__bit & 31)) & 1); })
__BUN_MS(unsigned char, _bittestandset, (long *__base, long __bit), { long __m = 1l << (__bit & 31); long *__p = __base + (__bit >> 5); unsigned char __old = (*__p & __m) != 0; *__p |= __m; return __old; })
__BUN_MS(unsigned char, _bittestandreset, (long *__base, long __bit), { long __m = 1l << (__bit & 31); long *__p = __base + (__bit >> 5); unsigned char __old = (*__p & __m) != 0; *__p &= ~__m; return __old; })
__BUN_MS(unsigned char, _bittestandcomplement, (long *__base, long __bit), { long __m = 1l << (__bit & 31); long *__p = __base + (__bit >> 5); unsigned char __old = (*__p & __m) != 0; *__p ^= __m; return __old; })
__BUN_MS(unsigned char, _bittest64, (__int64 const *__base, __int64 __bit), { return (unsigned char)((__base[__bit >> 6] >> (__bit & 63)) & 1); })
__BUN_MS(unsigned char, _bittestandset64, (__int64 *__base, __int64 __bit), { __int64 __m = 1ll << (__bit & 63); __int64 *__p = __base + (__bit >> 6); unsigned char __old = (*__p & __m) != 0; *__p |= __m; return __old; })
__BUN_MS(unsigned char, _bittestandreset64, (__int64 *__base, __int64 __bit), { __int64 __m = 1ll << (__bit & 63); __int64 *__p = __base + (__bit >> 6); unsigned char __old = (*__p & __m) != 0; *__p &= ~__m; return __old; })
__BUN_MS(unsigned char, _bittestandcomplement64, (__int64 *__base, __int64 __bit), { __int64 __m = 1ll << (__bit & 63); __int64 *__p = __base + (__bit >> 6); unsigned char __old = (*__p & __m) != 0; *__p ^= __m; return __old; })

/* Wide arithmetic. */
__BUN_MS(__int64, __emul, (int __a, int __b), { return (__int64)__a * __b; })
__BUN_MS(unsigned __int64, __emulu, (unsigned int __a, unsigned int __b), { return (unsigned __int64)__a * __b; })
__BUN_MS(unsigned __int64, __umulh, (unsigned __int64 __a, unsigned __int64 __b), { return (unsigned __int64)(((unsigned __int128)__a * __b) >> 64); })
__BUN_MS(__int64, __mulh, (__int64 __a, __int64 __b), { return (__int64)(((__int128)__a * __b) >> 64); })
__BUN_MS(unsigned __int64, _umul128, (unsigned __int64 __a, unsigned __int64 __b, unsigned __int64 *__high), { unsigned __int128 __p = (unsigned __int128)__a * __b; *__high = (unsigned __int64)(__p >> 64); return (unsigned __int64)__p; })
__BUN_MS(__int64, _mul128, (__int64 __a, __int64 __b, __int64 *__high), { __int128 __p = (__int128)__a * __b; *__high = (__int64)(__p >> 64); return (__int64)__p; })
__BUN_MS(unsigned __int64, _udiv128, (unsigned __int64 __high, unsigned __int64 __low, unsigned __int64 __divisor, unsigned __int64 *__remainder), { unsigned __int128 __n = ((unsigned __int128)__high << 64) | __low; *__remainder = (unsigned __int64)(__n % __divisor); return (unsigned __int64)(__n / __divisor); })
__BUN_MS(__int64, _div128, (__int64 __high, __int64 __low, __int64 __divisor, __int64 *__remainder), { __int128 __n = (__int128)(((unsigned __int128)(unsigned __int64)__high << 64) | (unsigned __int64)__low); *__remainder = (__int64)(__n % __divisor); return (__int64)(__n / __divisor); })
__BUN_MS(unsigned __int64, __shiftleft128, (unsigned __int64 __low, unsigned __int64 __high, unsigned char __shift), { __shift &= 63; return __shift ? (__high << __shift) | (__low >> (64 - __shift)) : __high; })
__BUN_MS(unsigned __int64, __shiftright128, (unsigned __int64 __low, unsigned __int64 __high, unsigned char __shift), { __shift &= 63; return __shift ? (__low >> __shift) | (__high << (64 - __shift)) : __low; })
__BUN_MS(unsigned __int64, __ll_lshift, (unsigned __int64 __x, int __n), { return __x << (__n & 63); })
__BUN_MS(__int64, __ll_rshift, (__int64 __x, int __n), { return __x >> (__n & 63); })
__BUN_MS(unsigned __int64, __ull_rshift, (unsigned __int64 __x, int __n), { return __x >> (__n & 63); })
__BUN_MS(__int64, _abs64, (__int64 __x), { return __x < 0 ? (__int64)(0 - (unsigned __int64)__x) : __x; })

/* Interlocked operations: all of them are sequentially consistent here, which every suffix
   (_acq, _rel, _nf: ARM's) allows. */
#define __BUN_MS_INTERLOCKED(T, W, S) \
  __BUN_MS(T, _InterlockedExchange##W##S, (T volatile *__p, T __v), { return __atomic_exchange_n(__p, __v, __ATOMIC_SEQ_CST); }) \
  __BUN_MS(T, _InterlockedExchangeAdd##W##S, (T volatile *__p, T __v), { return __sync_fetch_and_add(__p, __v); }) \
  __BUN_MS(T, _InterlockedCompareExchange##W##S, (T volatile *__p, T __exchange, T __comparand), { return __sync_val_compare_and_swap(__p, __comparand, __exchange); }) \
  __BUN_MS(T, _InterlockedAnd##W##S, (T volatile *__p, T __v), { return __sync_fetch_and_and(__p, __v); }) \
  __BUN_MS(T, _InterlockedOr##W##S, (T volatile *__p, T __v), { return __sync_fetch_and_or(__p, __v); }) \
  __BUN_MS(T, _InterlockedXor##W##S, (T volatile *__p, T __v), { return __sync_fetch_and_xor(__p, __v); })
#define __BUN_MS_INTERLOCKED_COUNT(T, W, S) \
  __BUN_MS(T, _InterlockedIncrement##W##S, (T volatile *__p), { return __sync_add_and_fetch(__p, (T)1); }) \
  __BUN_MS(T, _InterlockedDecrement##W##S, (T volatile *__p), { return __sync_sub_and_fetch(__p, (T)1); })
#define __BUN_MS_INTERLOCKED_WIDTHS(S) \
  __BUN_MS_INTERLOCKED(char, 8, S) \
  __BUN_MS_INTERLOCKED(short, 16, S) \
  __BUN_MS_INTERLOCKED(long, , S) \
  __BUN_MS_INTERLOCKED(__int64, 64, S) \
  __BUN_MS_INTERLOCKED_COUNT(short, 16, S) \
  __BUN_MS_INTERLOCKED_COUNT(long, , S) \
  __BUN_MS_INTERLOCKED_COUNT(__int64, 64, S) \
  __BUN_MS(void *, _InterlockedExchangePointer##S, (void *volatile *__p, void *__v), { return __atomic_exchange_n(__p, __v, __ATOMIC_SEQ_CST); }) \
  __BUN_MS(void *, _InterlockedCompareExchangePointer##S, (void *volatile *__p, void *__exchange, void *__comparand), { return __sync_val_compare_and_swap(__p, __comparand, __exchange); })
__BUN_MS_INTERLOCKED_WIDTHS()
__BUN_MS_INTERLOCKED_WIDTHS(_acq)
__BUN_MS_INTERLOCKED_WIDTHS(_rel)
__BUN_MS_INTERLOCKED_WIDTHS(_nf)
#undef __BUN_MS_INTERLOCKED
#undef __BUN_MS_INTERLOCKED_COUNT
#undef __BUN_MS_INTERLOCKED_WIDTHS
__BUN_MS(long, _InterlockedAdd, (long volatile *__p, long __v), { return __sync_add_and_fetch(__p, __v); })
__BUN_MS(__int64, _InterlockedAdd64, (__int64 volatile *__p, __int64 __v), { return __sync_add_and_fetch(__p, __v); })
__BUN_MS(unsigned char, _interlockedbittestandset, (long volatile *__base, long __bit), { long __m = 1l << (__bit & 31); return (unsigned char)((__sync_fetch_and_or(__base + (__bit >> 5), __m) & __m) != 0); })
__BUN_MS(unsigned char, _interlockedbittestandreset, (long volatile *__base, long __bit), { long __m = 1l << (__bit & 31); return (unsigned char)((__sync_fetch_and_and(__base + (__bit >> 5), ~__m) & __m) != 0); })
__BUN_MS(unsigned char, _interlockedbittestandset64, (__int64 volatile *__base, __int64 __bit), { __int64 __m = 1ll << (__bit & 63); return (unsigned char)((__sync_fetch_and_or(__base + (__bit >> 6), __m) & __m) != 0); })
__BUN_MS(unsigned char, _interlockedbittestandreset64, (__int64 volatile *__base, __int64 __bit), { __int64 __m = 1ll << (__bit & 63); return (unsigned char)((__sync_fetch_and_and(__base + (__bit >> 6), ~__m) & __m) != 0); })
__BUN_MS(unsigned char, _InterlockedCompareExchange128, (__int64 volatile *__p, __int64 __high, __int64 __low, __int64 *__comparand), { (void)__p; (void)__high; (void)__low; (void)__comparand; return (unsigned char)__builtin_bun_unsupported("_InterlockedCompareExchange128: a 16-byte compare and swap"); })

/* Plain loads and stores the optimizer must leave alone (what <xatomic.h> builds on). */
__BUN_MS(char, __iso_volatile_load8, (const volatile char *__p), { return *__p; })
__BUN_MS(short, __iso_volatile_load16, (const volatile short *__p), { return *__p; })
__BUN_MS(int, __iso_volatile_load32, (const volatile int *__p), { return *__p; })
__BUN_MS(__int64, __iso_volatile_load64, (const volatile __int64 *__p), { return *__p; })
__BUN_MS(void, __iso_volatile_store8, (volatile char *__p, char __v), { *__p = __v; })
__BUN_MS(void, __iso_volatile_store16, (volatile short *__p, short __v), { *__p = __v; })
__BUN_MS(void, __iso_volatile_store32, (volatile int *__p, int __v), { *__p = __v; })
__BUN_MS(void, __iso_volatile_store64, (volatile __int64 *__p, __int64 __v), { *__p = __v; })

/* Barriers: for the compiler alone, and for the processor too. */
__BUN_MS(void, _ReadWriteBarrier, (void), { __asm__ __volatile__("" ::: "memory"); })
__BUN_MS(void, _ReadBarrier, (void), { __asm__ __volatile__("" ::: "memory"); })
__BUN_MS(void, _WriteBarrier, (void), { __asm__ __volatile__("" ::: "memory"); })
__BUN_MS(void, __faststorefence, (void), { __sync_synchronize(); })
__BUN_MS(void, __dmb, (unsigned int __kind), { (void)__kind; __sync_synchronize(); })
__BUN_MS(void, __dsb, (unsigned int __kind), { (void)__kind; __sync_synchronize(); })
__BUN_MS(void, __isb, (unsigned int __kind), { (void)__kind; __sync_synchronize(); })
__BUN_MS(void, __yield, (void), { __asm__ __volatile__("" ::: "memory"); })

/* Strings of bytes, words and so on, front to back. */
__BUN_MS(void, __movsb, (unsigned char *__to, unsigned char const *__from, unsigned __int64 __count), { while (__count--) *__to++ = *__from++; })
__BUN_MS(void, __movsw, (unsigned short *__to, unsigned short const *__from, unsigned __int64 __count), { while (__count--) *__to++ = *__from++; })
__BUN_MS(void, __movsd, (unsigned long *__to, unsigned long const *__from, unsigned __int64 __count), { while (__count--) *__to++ = *__from++; })
__BUN_MS(void, __movsq, (unsigned __int64 *__to, unsigned __int64 const *__from, unsigned __int64 __count), { while (__count--) *__to++ = *__from++; })
__BUN_MS(void, __stosb, (unsigned char *__to, unsigned char __value, unsigned __int64 __count), { while (__count--) *__to++ = __value; })
__BUN_MS(void, __stosw, (unsigned short *__to, unsigned short __value, unsigned __int64 __count), { while (__count--) *__to++ = __value; })
__BUN_MS(void, __stosd, (unsigned long *__to, unsigned long __value, unsigned __int64 __count), { while (__count--) *__to++ = __value; })
__BUN_MS(void, __stosq, (unsigned __int64 *__to, unsigned __int64 __value, unsigned __int64 __count), { while (__count--) *__to++ = __value; })

/* The frame. (Each of these is compiled into its caller.) */
__BUN_MS(void *, _AddressOfReturnAddress, (void), { return (char *)__builtin_frame_address(0) + 8; })
__BUN_MS(void *, _ReturnAddress, (void), { return __builtin_return_address(0); })
__BUN_MS(void, __ud2, (void), { __builtin_trap(); })

#if defined(_M_X64)
/* The processor. */
__BUN_MS(void, __cpuid, (int __info[4], int __leaf), { __asm__("cpuid" : "=a"(__info[0]), "=b"(__info[1]), "=c"(__info[2]), "=d"(__info[3]) : "0"(__leaf), "2"(0)); })
__BUN_MS(void, __cpuidex, (int __info[4], int __leaf, int __subleaf), { __asm__("cpuid" : "=a"(__info[0]), "=b"(__info[1]), "=c"(__info[2]), "=d"(__info[3]) : "0"(__leaf), "2"(__subleaf)); })
__BUN_MS(unsigned __int64, __rdtsc, (void), { unsigned int __low, __high; __asm__ __volatile__("rdtsc" : "=a"(__low), "=d"(__high)); return ((unsigned __int64)__high << 32) | __low; })
__BUN_MS(unsigned __int64, __rdtscp, (unsigned int *__aux), { unsigned int __low, __high, __id; __asm__ __volatile__("rdtscp" : "=a"(__low), "=d"(__high), "=c"(__id)); *__aux = __id; return ((unsigned __int64)__high << 32) | __low; })
__BUN_MS(unsigned __int64, _xgetbv, (unsigned int __index), { unsigned int __low, __high; __asm__ __volatile__("xgetbv" : "=a"(__low), "=d"(__high) : "c"(__index)); return ((unsigned __int64)__high << 32) | __low; })
__BUN_MS(void, __debugbreak, (void), { __asm__ __volatile__("int3"); })
__BUN_MS(void, __nop, (void), { __asm__ __volatile__("nop"); })
/* (`int 0x29` with the code in ecx; any way of stopping at once will do.) */
__BUN_MS(void, __fastfail, (unsigned int __code), { (void)__code; __builtin_trap(); })
/* The segment that holds the thread's environment block. */
__BUN_MS(unsigned char, __readgsbyte, (unsigned long __offset), { unsigned char __v; __asm__ __volatile__("movb %%gs:(%1), %0" : "=q"(__v) : "r"((unsigned __int64)__offset)); return __v; })
__BUN_MS(unsigned short, __readgsword, (unsigned long __offset), { unsigned short __v; __asm__ __volatile__("movw %%gs:(%1), %0" : "=r"(__v) : "r"((unsigned __int64)__offset)); return __v; })
__BUN_MS(unsigned long, __readgsdword, (unsigned long __offset), { unsigned long __v; __asm__ __volatile__("movl %%gs:(%1), %0" : "=r"(__v) : "r"((unsigned __int64)__offset)); return __v; })
__BUN_MS(unsigned __int64, __readgsqword, (unsigned long __offset), { unsigned __int64 __v; __asm__ __volatile__("movq %%gs:(%1), %0" : "=r"(__v) : "r"((unsigned __int64)__offset)); return __v; })
__BUN_MS(void, __writegsbyte, (unsigned long __offset, unsigned char __v), { __asm__ __volatile__("movb %0, %%gs:(%1)" : : "q"(__v), "r"((unsigned __int64)__offset) : "memory"); })
__BUN_MS(void, __writegsword, (unsigned long __offset, unsigned short __v), { __asm__ __volatile__("movw %0, %%gs:(%1)" : : "r"(__v), "r"((unsigned __int64)__offset) : "memory"); })
__BUN_MS(void, __writegsdword, (unsigned long __offset, unsigned long __v), { __asm__ __volatile__("movl %0, %%gs:(%1)" : : "r"(__v), "r"((unsigned __int64)__offset) : "memory"); })
__BUN_MS(void, __writegsqword, (unsigned long __offset, unsigned __int64 __v), { __asm__ __volatile__("movq %0, %%gs:(%1)" : : "r"(__v), "r"((unsigned __int64)__offset) : "memory"); })
__BUN_MS(unsigned __int64, __readeflags, (void), { return (unsigned __int64)__builtin_bun_unsupported("__readeflags: reading the flags (which would disturb the stack)"); })
__BUN_MS(void, __halt, (void), { (void)__builtin_bun_unsupported("__halt: a privileged instruction"); })
#endif

#if defined(_M_ARM64)
/* Loads that acquire and stores that release. */
__BUN_MS(unsigned __int8, __load_acquire8, (const volatile unsigned __int8 *__p), { return __atomic_load_n(__p, __ATOMIC_ACQUIRE); })
__BUN_MS(unsigned __int16, __load_acquire16, (const volatile unsigned __int16 *__p), { return __atomic_load_n(__p, __ATOMIC_ACQUIRE); })
__BUN_MS(unsigned __int32, __load_acquire32, (const volatile unsigned __int32 *__p), { return __atomic_load_n(__p, __ATOMIC_ACQUIRE); })
__BUN_MS(unsigned __int64, __load_acquire64, (const volatile unsigned __int64 *__p), { return __atomic_load_n(__p, __ATOMIC_ACQUIRE); })
__BUN_MS(unsigned __int8, __ldar8, (const volatile unsigned __int8 *__p), { return __atomic_load_n(__p, __ATOMIC_SEQ_CST); })
__BUN_MS(unsigned __int16, __ldar16, (const volatile unsigned __int16 *__p), { return __atomic_load_n(__p, __ATOMIC_SEQ_CST); })
__BUN_MS(unsigned __int32, __ldar32, (const volatile unsigned __int32 *__p), { return __atomic_load_n(__p, __ATOMIC_SEQ_CST); })
__BUN_MS(unsigned __int64, __ldar64, (const volatile unsigned __int64 *__p), { return __atomic_load_n(__p, __ATOMIC_SEQ_CST); })
__BUN_MS(void, __stlr8, (volatile unsigned __int8 *__p, unsigned __int8 __v), { __atomic_store_n(__p, __v, __ATOMIC_RELEASE); })
__BUN_MS(void, __stlr16, (volatile unsigned __int16 *__p, unsigned __int16 __v), { __atomic_store_n(__p, __v, __ATOMIC_RELEASE); })
__BUN_MS(void, __stlr32, (volatile unsigned __int32 *__p, unsigned __int32 __v), { __atomic_store_n(__p, __v, __ATOMIC_RELEASE); })
__BUN_MS(void, __stlr64, (volatile unsigned __int64 *__p, unsigned __int64 __v), { __atomic_store_n(__p, __v, __ATOMIC_RELEASE); })
__BUN_MS(void, __prefetch, (const volatile void *__p), { (void)__p; })
__BUN_MS(void, __prefetch2, (const volatile void *__p, unsigned char __kind), { (void)__p; (void)__kind; })
__BUN_MS(unsigned int, _CountLeadingZeros, (unsigned long __x), { return __x ? (unsigned int)__builtin_clz(__x) : 32u; })
__BUN_MS(unsigned int, _CountLeadingZeros64, (unsigned __int64 __x), { return __x ? (unsigned int)__builtin_clzll(__x) : 64u; })
__BUN_MS(unsigned int, _CountTrailingZeros, (unsigned long __x), { return __x ? (unsigned int)__builtin_ctz(__x) : 32u; })
__BUN_MS(unsigned int, _CountTrailingZeros64, (unsigned __int64 __x), { return __x ? (unsigned int)__builtin_ctzll(__x) : 64u; })
__BUN_MS(unsigned int, _CountOneBits, (unsigned long __x), { return (unsigned int)__builtin_popcount(__x); })
__BUN_MS(unsigned int, _CountOneBits64, (unsigned __int64 __x), { return (unsigned int)__builtin_popcountll(__x); })
/* The registers themselves: x18 holds the thread's environment block. */
__BUN_MS(unsigned __int64, __getReg, (int __register), { (void)__register; return (unsigned __int64)__builtin_bun_unsupported("__getReg: reading a named register"); })
__BUN_MS(unsigned __int64, __readx18qword, (unsigned long __offset), { (void)__offset; return (unsigned __int64)__builtin_bun_unsupported("__readx18qword: reading through x18"); })
__BUN_MS(unsigned long, __readx18dword, (unsigned long __offset), { (void)__offset; return (unsigned long)__builtin_bun_unsupported("__readx18dword: reading through x18"); })
__BUN_MS(unsigned short, __readx18word, (unsigned long __offset), { (void)__offset; return (unsigned short)__builtin_bun_unsupported("__readx18word: reading through x18"); })
__BUN_MS(unsigned char, __readx18byte, (unsigned long __offset), { (void)__offset; return (unsigned char)__builtin_bun_unsupported("__readx18byte: reading through x18"); })
__BUN_MS(__int64, _ReadStatusReg, (int __register), { (void)__register; return (__int64)__builtin_bun_unsupported("_ReadStatusReg: reading a system register"); })
__BUN_MS(void, __break, (int __code), { (void)__code; __builtin_trap(); })
__BUN_MS(void, __debugbreak, (void), { __builtin_trap(); })
__BUN_MS(void, __fastfail, (unsigned int __code), { (void)__code; __builtin_trap(); })
#endif
