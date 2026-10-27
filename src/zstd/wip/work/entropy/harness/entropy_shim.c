/* The inline functions of fse.h, for the differential test. */
#define FSE_STATIC_LINKING_ONLY
#include "mem.h"
#include "bitstream.h"
#include "fse.h"

size_t shim_fse_encode3(void* dst, size_t cap, const FSE_CTable* ta, const FSE_CTable* tb, const FSE_CTable* tc,
                        const BYTE* sa, const BYTE* sb, const BYTE* sc, size_t n)
{
    BIT_CStream_t bitC;
    FSE_CState_t a, b, c, d;
    size_t i;
    { size_t const e = BIT_initCStream(&bitC, dst, cap); if (ERR_isError(e)) return e; }
    FSE_initCState2(&a, ta, sa[n-1]);
    FSE_initCState2(&b, tb, sb[n-1]);
    FSE_initCState2(&c, tc, sc[n-1]);
    for (i = n-2; i < n; i--) {
        FSE_encodeSymbol(&bitC, &b, sb[i]);
        FSE_encodeSymbol(&bitC, &a, sa[i]);
        FSE_encodeSymbol(&bitC, &c, sc[i]);
        BIT_flushBits(&bitC);
    }
    FSE_flushCState(&bitC, &a);
    FSE_flushCState(&bitC, &b);
    FSE_flushCState(&bitC, &c);
    FSE_initCState(&d, ta);
    FSE_flushCState(&bitC, &d);
    return BIT_closeCStream(&bitC);
}

U32 shim_fse_getMaxNbBits(const FSE_CTable* ct, U32 symbol)
{
    FSE_CState_t s;
    FSE_initCState(&s, ct);
    return FSE_getMaxNbBits(s.symbolTT, symbol);
}

U32 shim_fse_bitCost(const FSE_CTable* ct, U32 symbol, U32 accuracyLog)
{
    FSE_CState_t s;
    FSE_initCState(&s, ct);
    return FSE_bitCost(s.symbolTT, s.stateLog, symbol, accuracyLog);
}
